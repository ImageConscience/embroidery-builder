import type { AdminLike } from "./files.server";
import { LEGACY, MF_KEY, MF_NAMESPACE, MF_PHOTO_KEY, TEMPLATE_TYPE, type Template, type TemplateData } from "./templates";

// Location templates live in Shopify as merchant-owned metaobjects (type imprint_location_template),
// each belonging to one method. Products list their templates in the product metafield
// imprint.location_templates (at most one per method), and the builder draws on the product's
// imprint.mockup_photo. Because this is plain Shopify data, templates and photos can also be assigned
// with the Shopify bulk editor, CSV/Matrixify imports or any other tool that writes metafields.

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

// Create the metaobject and metafield definitions if they don't exist yet, then move any data from
// the earlier embroidery-only version.
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
        name: "Imprint location template",
        description: "Where one customization method can decorate a product photo. Managed in the Imprint Customizer app.",
        displayNameKey: "name",
        access: { storefront: "PUBLIC_READ" },
        fieldDefinitions: [
          { key: "name", name: "Name", type: "single_line_text_field", required: true },
          { key: "method", name: "Method", type: "single_line_text_field" },
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
      name: "Imprint location templates",
      type: "list.metaobject_reference",
      description: "Which customization methods and locations the logo builder offers on this product (one template per method).",
      validations: [{ name: "metaobject_definition_id", value: defId }],
    },
    {
      ownerType: "PRODUCT",
      key: MF_PHOTO_KEY,
      name: "Imprint mockup photo",
      type: "file_reference",
      description: "The photo the logo builder draws on. Must match the framing of the product's location templates. Without it the builder doesn't show.",
      validations: [{ name: "file_type_options", value: JSON.stringify(["Image"]) }],
    },
    {
      ownerType: "PRODUCTVARIANT",
      key: MF_PHOTO_KEY,
      name: "Imprint mockup photo",
      type: "file_reference",
      description: "Optional: this color's photo for the logo builder. Falls back to the product's imprint mockup photo.",
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
  try {
    await migrateLegacy(admin);
  } catch (e) {
    console.error("[templates] moving embroidery-only data failed", e);
  }
  ready.set(shop, defId);
  return defId;
}

const fieldMap = (fields: { key: string; value: string | null }[]) => Object.fromEntries(fields.map((f) => [f.key, f.value]));
const parse = <T,>(v: string | null | undefined, d: T): T => {
  try {
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const idList = (v: string | null | undefined): string[] => parse<string[]>(v, []).filter((x) => typeof x === "string");

function toTemplate(n: any, defaultMethod = ""): Template {
  const f = fieldMap(n.fields ?? []);
  return {
    id: n.id,
    handle: n.handle,
    updatedAt: n.updatedAt,
    name: f.name ?? n.displayName ?? "Untitled",
    method: f.method || defaultMethod,
    photoWidthIn: Number(f.photo_width_in) || 0,
    photoRatio: Number(f.photo_ratio) || 0,
    zones: parse(f.zones, []),
    calibration: parse(f.calibration, null),
    referenceImage: f.reference_image ?? "",
    notes: f.notes ?? "",
  };
}

const isOurRef = (r: any) => r.namespace === MF_NAMESPACE && r.key === MF_KEY;

export async function listTemplates(admin: AdminLike) {
  const d = await gql(admin, `#graphql
    query templates($type: String!) {
      metaobjects(type: $type, first: 200, sortKey: "display_name") {
        nodes {
          id handle displayName updatedAt fields { key value }
          referencedBy(first: 250) { nodes { key namespace } pageInfo { hasNextPage } }
        }
      }
    }`, { type: TEMPLATE_TYPE });
  return (d?.metaobjects?.nodes ?? []).map((n: any) => {
    const refs = (n.referencedBy?.nodes ?? []).filter(isOurRef);
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
  hasPhoto: boolean; // has its own imprint mockup photo (image/width/height are that photo when set)
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
    .filter((r: any) => isOurRef(r) && r.referencer?.id)
    .map((r: any) => toProduct(r.referencer));
  return { template: toTemplate(n), products, productsMore: !!n.referencedBy?.pageInfo?.hasNextPage };
}

// Products that already have an imprint mockup photo (for choosing a template's reference photo).
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

async function setMetafields(admin: AdminLike, metafields: Record<string, unknown>[]) {
  const failed: string[] = [];
  for (let i = 0; i < metafields.length; i += 25) {
    const d = await gql(admin, `#graphql
      mutation setMf($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
      }`, { metafields: metafields.slice(i, i + 25) });
    const errs = d?.metafieldsSet?.userErrors ?? [];
    if (errs.length) failed.push(...errs.map((e: any) => e.message));
  }
  return failed;
}

export async function setProductPhoto(admin: AdminLike, productId: string, fileId: string) {
  const failed = await setMetafields(admin, [{ ownerId: productId, namespace: MF_NAMESPACE, key: MF_PHOTO_KEY, type: "file_reference", value: fileId }]);
  if (failed.length) throw new Error(failed.join("; "));
}

function fieldsFor(t: TemplateData) {
  return [
    { key: "name", value: t.name },
    { key: "method", value: t.method },
    { key: "photo_width_in", value: String(t.photoWidthIn) },
    { key: "photo_ratio", value: String(t.photoRatio) },
    { key: "zones", value: JSON.stringify(t.zones) },
    { key: "calibration", value: t.calibration ? JSON.stringify(t.calibration) : "" },
    { key: "reference_image", value: t.referenceImage },
    { key: "notes", value: t.notes },
  ];
}

async function createTemplate(admin: AdminLike, t: TemplateData) {
  const d = await gql(admin, `#graphql
    mutation createTemplate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
    }`, { metaobject: { type: TEMPLATE_TYPE, fields: fieldsFor(t) } });
  userErrors(d?.metaobjectCreate?.userErrors, "metaobjectCreate");
  const newId = d?.metaobjectCreate?.metaobject?.id;
  if (!newId) throw new Error("metaobjectCreate returned no id");
  return newId as string;
}

export async function saveTemplate(admin: AdminLike, shop: string, id: string | null, t: TemplateData): Promise<string> {
  await ensureDefinitions(admin, shop);
  if (!id) return createTemplate(admin, t);
  const d = await gql(admin, `#graphql
    mutation updateTemplate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
    }`, { id, metaobject: { fields: fieldsFor(t) } });
  userErrors(d?.metaobjectUpdate?.userErrors, "metaobjectUpdate");
  return id;
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

export type TargetProduct = { id: string; title: string; templates: string[]; hasPhoto: boolean };

// Resolve a target into products, with each product's current template list.
export async function resolveTarget(admin: AdminLike, target: Target) {
  const out: TargetProduct[] = [];
  const PRODUCT = `id title metafield(namespace: "${MF_NAMESPACE}", key: "${MF_KEY}") { value } photo: metafield(namespace: "${MF_NAMESPACE}", key: "${MF_PHOTO_KEY}") { value }`;
  const push = (p: any) => out.push({ id: p.id, title: p.title, templates: idList(p.metafield?.value), hasPhoto: !!p.photo?.value });

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

// A product keeps one template per method: adding a template replaces that product's template for the same method.
export function planAssignment(products: TargetProduct[], templateId: string, method: string, methodOf: Record<string, string>) {
  return products.map((p) => {
    const has = p.templates.includes(templateId);
    const sameMethod = p.templates.filter((t) => t !== templateId && methodOf[t] === method);
    const next = [...p.templates.filter((t) => t !== templateId && methodOf[t] !== method), templateId];
    return { ...p, has, replacing: sameMethod.length > 0, next };
  });
}

export async function assignTemplate(admin: AdminLike, plan: ReturnType<typeof planAssignment>) {
  const changes = plan.filter((p) => !p.has || p.replacing);
  const failed = await setMetafields(
    admin,
    changes.map((p) => ({ ownerId: p.id, namespace: MF_NAMESPACE, key: MF_KEY, type: "list.metaobject_reference", value: JSON.stringify(p.next) })),
  );
  return { done: failed.length ? 0 : changes.length, failed };
}

// Remove one template from products, keeping their templates for other methods.
export async function unassignTemplate(admin: AdminLike, templateId: string, productIds: string[]) {
  const products = await resolveTarget(admin, { kind: "products", ids: productIds });
  const keep = products.map((p) => ({ ...p, next: p.templates.filter((t) => t !== templateId) }));
  const toSet = keep.filter((p) => p.next.length);
  const toDelete = keep.filter((p) => !p.next.length);
  const failed = await setMetafields(
    admin,
    toSet.map((p) => ({ ownerId: p.id, namespace: MF_NAMESPACE, key: MF_KEY, type: "list.metaobject_reference", value: JSON.stringify(p.next) })),
  );
  for (let i = 0; i < toDelete.length; i += 25) {
    const d = await gql(admin, `#graphql
      mutation unassign($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { deletedMetafields { ownerId } userErrors { field message } }
      }`, { metafields: toDelete.slice(i, i + 25).map((p) => ({ ownerId: p.id, namespace: MF_NAMESPACE, key: MF_KEY })) });
    userErrors(d?.metafieldsDelete?.userErrors, "metafieldsDelete");
  }
  if (failed.length) throw new Error(failed.join("; "));
  return keep.length;
}

/* ---------- moving data from the embroidery-only version ---------- */

const migrated = new Set<AdminLike>();

// Copies embroidery_location_template entries to imprint templates (as Standard Embroidery), re-points
// products to them and copies embroidery.mockup_photo to imprint.mockup_photo. Runs once: it does nothing
// when imprint templates already exist or there is no old data. The old data is left in place.
async function migrateLegacy(admin: AdminLike) {
  if (migrated.has(admin)) return;
  migrated.add(admin);
  const has = await gql(admin, `#graphql
    query migrateCheck($newType: String!, $oldType: String!) {
      fresh: metaobjects(type: $newType, first: 1) { nodes { id } }
      old: metaobjectDefinitionByType(type: $oldType) { id }
    }`, { newType: TEMPLATE_TYPE, oldType: LEGACY.type });
  if (!has?.old?.id || has?.fresh?.nodes?.length) return;

  const old = await gql(admin, `#graphql
    query oldTemplates($type: String!) {
      metaobjects(type: $type, first: 200) {
        nodes { id handle displayName updatedAt fields { key value } referencedBy(first: 250) { nodes { key namespace referencer { ... on Product { id } } } } }
      }
    }`, { type: LEGACY.type });
  const productTemplates = new Map<string, string[]>();
  for (const n of old?.metaobjects?.nodes ?? []) {
    const t = toTemplate(n, "standard_embroidery");
    const newId = await createTemplate(admin, { ...t, method: "standard_embroidery" });
    for (const r of n.referencedBy?.nodes ?? []) {
      if (r.namespace !== LEGACY.namespace || r.key !== LEGACY.key || !r.referencer?.id) continue;
      productTemplates.set(r.referencer.id, [...(productTemplates.get(r.referencer.id) ?? []), newId]);
    }
  }
  const metafields: Record<string, unknown>[] = [...productTemplates].map(([ownerId, ids]) => ({
    ownerId, namespace: MF_NAMESPACE, key: MF_KEY, type: "list.metaobject_reference", value: JSON.stringify(ids),
  }));

  // Photos on products and variants.
  let after: string | null = null;
  let scanned = 0;
  do {
    const d: any = await gql(admin, `#graphql
      query oldPhotos($after: String) {
        products(first: 100, after: $after) {
          nodes {
            id photo: metafield(namespace: "${LEGACY.namespace}", key: "${LEGACY.photoKey}") { value }
            variants(first: 100) { nodes { id photo: metafield(namespace: "${LEGACY.namespace}", key: "${LEGACY.photoKey}") { value } } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`, { after });
    for (const p of d?.products?.nodes ?? []) {
      if (p.photo?.value) metafields.push({ ownerId: p.id, namespace: MF_NAMESPACE, key: MF_PHOTO_KEY, type: "file_reference", value: p.photo.value });
      for (const v of p.variants?.nodes ?? [])
        if (v.photo?.value) metafields.push({ ownerId: v.id, namespace: MF_NAMESPACE, key: MF_PHOTO_KEY, type: "file_reference", value: v.photo.value });
    }
    scanned += d?.products?.nodes?.length ?? 0;
    after = d?.products?.pageInfo?.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after && scanned < 5000);

  const failed = await setMetafields(admin, metafields);
  console.log(`[templates] moved ${old?.metaobjects?.nodes?.length ?? 0} templates and ${metafields.length} product fields to imprint.*; ${failed.length} failed`);
}

// The location templates a product offers (for checking a submitted design on the server).
export async function productTemplates(admin: AdminLike, productId: string | number) {
  const id = String(productId).startsWith("gid://") ? String(productId) : `gid://shopify/Product/${productId}`;
  const d = await gql(admin, `#graphql
    query productTemplates($id: ID!) {
      product(id: $id) {
        metafield(namespace: "${MF_NAMESPACE}", key: "${MF_KEY}") {
          references(first: 20) { nodes { ... on Metaobject { id handle displayName updatedAt fields { key value } } } }
        }
      }
    }`, { id });
  return ((d?.product?.metafield?.references?.nodes ?? []) as any[]).filter((n) => n?.id).map((n) => toTemplate(n));
}
