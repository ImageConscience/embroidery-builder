// Upload a file to the shop's Shopify Files (Settings > Files) and return its GID.

type Graphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;
export type AdminLike = { graphql: Graphql };

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

export async function uploadToShopifyFiles(
  admin: AdminLike,
  file: { name: string; type: string; bytes: Uint8Array },
  alt: string,
): Promise<string> {
  const isImage = IMAGE_TYPES.test(file.type);
  const mimeType = file.type || "application/octet-stream";

  const stagedRes = await admin.graphql(
    `#graphql
    mutation stagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [
          {
            filename: file.name,
            mimeType,
            resource: isImage ? "IMAGE" : "FILE",
            fileSize: String(file.bytes.byteLength),
            httpMethod: "POST",
          },
        ],
      },
    },
  );
  const staged = (await stagedRes.json()) as any;
  const errs = staged?.data?.stagedUploadsCreate?.userErrors;
  if (errs?.length) throw new Error("stagedUploadsCreate: " + errs.map((e: any) => e.message).join("; "));
  const target = staged?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned");

  const form = new FormData();
  for (const p of target.parameters as { name: string; value: string }[]) form.append(p.name, p.value);
  form.append("file", new Blob([file.bytes as unknown as ArrayBuffer], { type: mimeType }), file.name);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) throw new Error(`Staged upload failed (${up.status})`);

  const createRes = await admin.graphql(
    `#graphql
    mutation createFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: isImage ? "IMAGE" : "FILE",
            alt: alt.slice(0, 500),
          },
        ],
      },
    },
  );
  const created = (await createRes.json()) as any;
  const cErrs = created?.data?.fileCreate?.userErrors;
  if (cErrs?.length) throw new Error("fileCreate: " + cErrs.map((e: any) => e.message).join("; "));
  const id = created?.data?.fileCreate?.files?.[0]?.id;
  if (!id) throw new Error("fileCreate returned no file");
  return id as string;
}

// Look up download URLs for file GIDs. Images may take a few seconds to process.
export async function fileUrls(admin: AdminLike, ids: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const clean = ids.filter(Boolean);
  if (!clean.length) return out;
  const res = await admin.graphql(
    `#graphql
    query fileUrls($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on MediaImage { image { url } }
        ... on GenericFile { url }
      }
    }`,
    { variables: { ids: clean } },
  );
  const json = (await res.json()) as any;
  for (const n of json?.data?.nodes ?? []) {
    if (!n) continue;
    out[n.id] = n.image?.url ?? n.url ?? null;
  }
  return out;
}

// Upload an image to Shopify Files and wait (up to ~15 s) until Shopify has processed it,
// so its URL and size are known. Returns the file GID even if processing takes longer.
export async function uploadImageAndWait(
  admin: AdminLike,
  file: { name: string; type: string; bytes: Uint8Array },
  alt: string,
): Promise<{ id: string; url: string | null; width: number | null; height: number | null }> {
  const id = await uploadToShopifyFiles(admin, file, alt);
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await admin.graphql(
      `#graphql
      query imageReady($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url width height } } } }`,
      { variables: { id } },
    );
    const n = ((await res.json()) as any)?.data?.node;
    if (n?.image?.url) return { id, url: n.image.url, width: n.image.width ?? null, height: n.image.height ?? null };
    if (n?.fileStatus === "FAILED") throw new Error("Shopify couldn't process that image");
  }
  return { id, url: null, width: null, height: null };
}
