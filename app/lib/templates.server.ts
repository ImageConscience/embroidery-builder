import type { AdminLike } from "./files.server";
import {
  MF_KEY,
  MF_NAMESPACE,
  MF_PHOTO_KEY,
  TEMPLATE_TYPE,
  type Template,
  type TemplateData,
} from "./templates";

// Location templates live in Shopify as merchant-owned metaobjects (type embroidery_location_template),
// and products point at one through the product metafield embroidery.location_template.
// Because both are plain Shopify data, templates can be assigned in bulk with the app, the
// Shopify bulk editor, CSV/Matrixify imports or any other tool that writes metafields.

async function gql(admin: AdminLike, query: string, variables?: Record<string, unknown>) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as any;
  if (json?.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join("; "));
  return json?.data;
}
function userErrors(errs: any[] | undefined, what: string) {
  if (errs?.length) throw new Error(`${what}: ${errs.map((e) => e.message).join("; ")}`);
}

const ready = new Map<string, string>(); // shop -> metaobject definition id

// Create the metaobject definition and the product metafield definition if they don't exist yet.
export async function ensureDefinitions(admin: AdminLike, shop: string): Promise<string> {
  const cached = ready.get(shop);
  if (cached) return cached;

  let defId: string | undefined = (
    await gql(admin, `#graphql
      query templateDef($type: String!) { metaobjectDefinitionByType(type: $type) { id } }`, { type: TEMPLATE_TYPE })
  )?.metaobjectDefinitionByType?.id;

  if (!defId) {
    const d = await gql(admin, `#graphql
      mutation createTemplateDef($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id } userErrors { field message } }
      }`, {
      definition: {
        type: TEMPLATE_TYPE,
        name: "Embroidery location template",
        description: "Where logos can be embroidered on a product photo. Managed in the Embroidery Builder app.",
        displayNameKey: "name",
        access: { storefront: "PUBLIC_READ" },
        fieldDefinitions: [
          { key: "name", name: "Name", type: "single_line_text_field", required: true },
          { key: "photo_width_in", name: "Photo width (inches)", type: "number_decimal" },
          { key: "photo_ratio", name: "Photo height ÷ width", type: "number_decimal" },
          { key: "zones", name: "Locations", type: "json" },
          { key: "calibration", name: "Scale line", type: "json" },
          { key: "reference_image", name: "Reference photo", type: "url" },
          { key: "notes", name: "Notes", type: "multi_line_text_field" },
        ],
      },
    });
    userErrors(d?.metaobjectDefinitionCreate?.userErrors, "metaobjectDefinitionCreate");
    defId = d?.metaobjectDefinitionCreate?.metaobjectDefinition?.id;
    if (!defId) throw new Error("Couldn't create the template definition");
  }

  const wanted = [
    {
      ownerType: "PRODUCT",
      key: MF_KEY,
      name: "Embroidery location template",
      type: "metaobject_reference",
      description: "Which embroidery locations the logo builder offers on this product.",
      validations: [{ name: "metaobject_definition_id", value: defId }],
    },
    {
      ownerType: "PRODUCT",
      key: MF_PHOTO_KEY,
      name: "Embroidery mockup photo",
      type: "file_reference",
      description: "The photo the logo builder draws on. Must match the framing of the product's location template. Without it the builder doesn't show.",
      validations: [{ name: "file_type_options", value: JSON.stringify(["Image"]) }],
    },
    {
      ownerType: "PRODUCTVARIANT",
      key: MF_PHOTO_KEY,
      name: "Embroidery mockup photo",
      type: "file_reference",
      description: "Optional: this color's photo for the logo builder. Falls back to the product's embroidery mockup photo.",
      validations: [{ name: "file_type_options", value: JSON.stringify(["Image"]) }],
    },
  ];
  for (const w of wanted) {
    const mf = await gql(admin, `#graphql
      query defExists($ns: String!, $key: String!, $owner: MetafieldOwnerType!) {
        metafieldDefinitions(first: 1, ownerType: $owner, namespace: $ns, key: $key) { nodes { id } }
      }`, { ns: MF_NAMESPACE, key: w.key, owner: w.ownerType });
    if (mf?.metafieldDefinitions?.nodes?.length) continue;
    const create = async (definition: Record<string, unknown>) => {
      const d = await gql(admin, `#graphql
        mutation createDef($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } }
        }`, { definition });
      // TAKEN means another request created it first.
      return (d?.metafieldDefinitionCreate?.userErrors ?? []).filter((e: any) => e.code !== "TAKEN");
    };
    let errs = await create({ ...w, namespace: MF_NAMESPACE, pin: true });
    if (errs.length && w.key === MF_PHOTO_KEY) {
      // Photo fields still work without the "images only" rule; don't block templates over it.
      console.warn(`[templates] ${w.ownerType} photo definition: ${errs.map((e: any) => e.message).join("; ")}; retrying without validation`);
      const { validations: _v, ...rest } = w;
      errs = await create({ ...rest, namespace: MF_NAMESPACE, pin: w.ownerType === "PRODUCT" });
      if (errs.length) {
        console.error(`[templates] couldn't create ${w.ownerType} photo definition`, errs);
        continue;
      }
    }
    userErrors(errs, "metafieldDefinitionCreate");
  }
  ready.set(shop, defId);
  return defId;
}

const fieldMap = (fields: { key: string; value: string | null }[]) =>
  Object.fromEntries(fields.map((f) => [f.key, f.value]));
const parse = <T,>(v: string | null | undefined, d: T): T => {
  try {
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};

function toTemplate(n: any): Template {
  const f = fieldMap(n.fields ?? []);
  return {
    id: n.id,
    handle: n.handle,
    updatedAt: n.updatedAt,
    name: f.name ?? n.displayName ?? "Untitled",
    photoWidthIn: Number(f.photo_width_in) || 0,
    photoRatio: Number(f.photo_ratio) || 0,
    zones: parse(f.zones, []),
    calibration: parse(f.calibration, null),
    referenceImage: f.reference_image ?? "",
    notes: f.notes ?? "",
  };
}

export async function listTemplates(admin: AdminLike) {
  const d = await gql(admin, `#graphql
    query templates($type: String!) {
      metaobjects(type: $type, first: 100, sortKey: "display_name") {
        nodes {
          id handle displayName updatedAt fields { key value }
          referencedBy(first: 250) { nodes { key namespace } pageInfo { hasNextPage } }
        }
      }
    }`, { type: TEMPLATE_TYPE });
  return (d?.metaobjects?.nodes ?? []).map((n: any) => {
    const refs = (n.referencedBy?.nodes ?? []).filter((r: any) => r.namespace === MF_NAMESPACE && r.key === MF_KEY);
    return { ...toTemplate(n), usage: refs.length, usageMore: !!n.referencedBy?.pageInfo?.hasNextPage };
  });
}

export type TemplateProduct = {
  id: string;
  title: string;
  status: string;
  image: string | null;
  width: number | null;
  height: number | null;
  hasPhoto: boolean; // has its own embroidery mockup photo (image/width/height are that photo when set)
};

const PHOTO_FIELD = `photo: metafield(namespace: "${MF_NAMESPACE}", key: "${MF_PHOTO_KEY}") { reference { ... on MediaImage { image { url width height } } } }`;
const PRODUCT_FIELDS = `
  id title status
  featuredMedia { ... on MediaImage { image { url width height } } }
  ${PHOTO_FIELD}
`;
const toProduct = (p: any): TemplateProduct => {
  const photo = p.photo?.reference?.image;
  const img = photo ?? p.featuredMedia?.image;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    image: img?.url ?? null,
    width: img?.width ?? null,
    height: img?.height ?? null,
    hasPhoto: !!photo,
  };
};

// Products that already have an embroidery mockup photo (for choosing a template's reference photo).
export async function productsWithPhotos(admin: AdminLike, limit = 2000) {
  const out: { id: string; title: string; url: string; width: number; height: number }[] = [];
  let after: string | null = null;
  let scanned = 0;
  do {
    const d: any = await gql(admin, `#graphql
      query withPhotos($after: String) {
        products(first: 250, after: $after, sortKey: TITLE) { nodes { id title ${PHOTO_FIELD} } pageInfo { hasNextPage endCursor } }
      }`, { after });
    for (const p of d?.products?.nodes ?? []) {
      const img = p.photo?.reference?.image;
      if (img?.url) out.push({ id: p.id, title: p.title, url: img.url, width: img.width, height: img.height });
    }
    scanned += d?.products?.nodes?.length ?? 0;
    after = d?.products?.pageInfo?.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after && scanned < limit);
  return out;
}

export async function setProductPhoto(admin: AdminLike, productId: string, fileId: string) {
  const d = await gql(admin, `#graphql
    mutation setPhoto($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
    }`, { metafields: [{ ownerId: productId, namespace: MF_NAMESPACE, key: MF_PHOTO_KEY, type: "file_reference", value: fileId }] });
  userErrors(d?.metafieldsSet?.userErrors, "metafieldsSet");
}

export async function getTemplate(admin: AdminLike, id: string) {
  const d = await gql(admin, `#graphql
    query template($id: ID!) {
      metaobject(id: $id) {
        id handle displayName updatedAt fields { key value }
        referencedBy(first: 250) {
          nodes { key namespace referencer { ... on Product { ${PRODUCT_FIELDS} } } }
          pageInfo { hasNextPage }
        }
      }
    }`, { id });
  const n = d?.metaobject;
  if (!n) return null;
  const products: TemplateProduct[] = (n.referencedBy?.nodes ?? [])
    .filter((r: any) => r.namespace === MF_NAMESPACE && r.key === MF_KEY && r.referencer?.id)
    .map((r: any) => toProduct(r.referencer));
  return { template: toTemplate(n), products, productsMore: !!n.referencedBy?.pageInfo?.hasNextPage };
}

function fieldsFor(t: TemplateData) {
  return [
    { key: "name", value: t.name },
    { key: "photo_width_in", value: String(t.photoWidthIn) },
    { key: "photo_ratio", value: String(t.photoRatio) },
    { key: "zones", value: JSON.stringify(t.zones) },
    { key: "calibration", value: t.calibration ? JSON.stringify(t.calibration) : "" },
    { key: "reference_image", value: t.referenceImage },
    { key: "notes", value: t.notes },
  ];
}

export async function saveTemplate(admin: AdminLike, shop: string, id: string | null, t: TemplateData): Promise<string> {
  await ensureDefinitions(admin, shop);
  if (id) {
    const d = await gql(admin, `#graphql
      mutation updateTemplate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`, { id, metaobject: { fields: fieldsFor(t) } });
    userErrors(d?.metaobjectUpdate?.userErrors, "metaobjectUpdate");
    return id;
  }
  const d = await gql(admin, `#graphql
    mutation createTemplate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
    }`, { metaobject: { type: TEMPLATE_TYPE, fields: fieldsFor(t) } });
  userErrors(d?.metaobjectCreate?.userErrors, "metaobjectCreate");
  const newId = d?.metaobjectCreate?.metaobject?.id;
  if (!newId) throw new Error("metaobjectCreate returned no id");
  return newId;
}

export async function deleteTemplate(admin: AdminLike, id: string) {
  const d = await gql(admin, `#graphql
    mutation deleteTemplate($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`, { id });
  userErrors(d?.metaobjectDelete?.userErrors, "metaobjectDelete");
}

/* ---------- choosing products to assign ---------- */

export type Target =
  | { kind: "products"; ids: string[] }
  | { kind: "collection"; id: string }
  | { kind: "product_type" | "vendor" | "tag"; value: string };

const MAX_PRODUCTS = 5000;

const searchValue = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Resolve a target into product ids, with each product's current template (if any).
export async function resolveTarget(admin: AdminLike, target: Target) {
  const out: { id: string; title: string; current: string | null; hasPhoto: boolean }[] = [];
  const PRODUCT = `id title metafield(namespace: "${MF_NAMESPACE}", key: "${MF_KEY}") { value } photo: metafield(namespace: "${MF_NAMESPACE}", key: "${MF_PHOTO_KEY}") { value }`;
  const push = (p: any) => out.push({ id: p.id, title: p.title, current: p.metafield?.value ?? null, hasPhoto: !!p.photo?.value });

  if (target.kind === "products") {
    const ids = target.ids.filter((i) => /^gid:\/\/shopify\/Product\/\d+$/.test(i)).slice(0, MAX_PRODUCTS);
    for (let i = 0; i < ids.length; i += 100) {
      const d = await gql(admin, `#graphql
        query pick($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${PRODUCT} } } }`, { ids: ids.slice(i, i + 100) });
      (d?.nodes ?? []).filter((n: any) => n?.id).forEach(push);
    }
    return out;
  }

  let after: string | null = null;
  do {
    let conn: any;
    if (target.kind === "collection") {
      const d: any = await gql(admin, `#graphql
        query inCollection($id: ID!, $after: String) {
          collection(id: $id) { products(first: 250, after: $after) { nodes { ${PRODUCT} } pageInfo { hasNextPage endCursor } } }
        }`, { id: target.id, after });
      conn = d?.collection?.products;
    } else {
      const v = target.value.trim();
      if (!v) return out;
      const d: any = await gql(admin, `#graphql
        query search($q: String!, $after: String) {
          products(first: 250, after: $after, query: $q) { nodes { ${PRODUCT} } pageInfo { hasNextPage endCursor } }
        }`, { q: `${target.kind}:${searchValue(v)}`, after });
      conn = d?.products;
    }
    (conn?.nodes ?? []).forEach(push);
    after = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after && out.length < MAX_PRODUCTS);
  return out;
}

// Point products at a template (metafieldsSet takes 25 at a time).
export async function assignTemplate(admin: AdminLike, templateId: string, productIds: string[]) {
  let done = 0;
  const failed: string[] = [];
  for (let i = 0; i < productIds.length; i += 25) {
    const chunk = productIds.slice(i, i + 25);
    const d = await gql(admin, `#graphql
      mutation assign($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
      }`, {
      metafields: chunk.map((ownerId) => ({ ownerId, namespace: MF_NAMESPACE, key: MF_KEY, type: "metaobject_reference", value: templateId })),
    });
    const errs = d?.metafieldsSet?.userErrors ?? [];
    if (errs.length) failed.push(...errs.map((e: any) => e.message));
    else done += chunk.length;
  }
  return { done, failed };
}

export async function unassignTemplate(admin: AdminLike, productIds: string[]) {
  let done = 0;
  for (let i = 0; i < productIds.length; i += 25) {
    const chunk = productIds.slice(i, i + 25);
    const d = await gql(admin, `#graphql
      mutation unassign($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { deletedMetafields { ownerId } userErrors { field message } }
      }`, { metafields: chunk.map((ownerId) => ({ ownerId, namespace: MF_NAMESPACE, key: MF_KEY })) });
    userErrors(d?.metafieldsDelete?.userErrors, "metafieldsDelete");
    done += chunk.length;
  }
  return done;
}
