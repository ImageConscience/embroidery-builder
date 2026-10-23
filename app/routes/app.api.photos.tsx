import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { uploadImageAndWait } from "../lib/files.server";
import { ensureDefinitions, productsWithPhotos, setProductPhoto } from "../lib/templates.server";

// Embroidery mockup photos for the template editor.
// GET: products that already have an embroidery mockup photo.
// POST (multipart): upload an image to Shopify Files; with productId, also set it as that product's photo.

const MAX = 20 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDefinitions(admin, session.shop);
  try {
    return { ok: true, products: await productsWithPhotos(admin) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't load products", products: [] };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const file = form.get("photo");
  const productId = String(form.get("productId") || "");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose an image." };
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return { ok: false, error: "Use a JPG, PNG or WebP image." };
  if (file.size > MAX) return { ok: false, error: "That image is over 20 MB." };
  try {
    const img = await uploadImageAndWait(
      admin,
      { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      "Embroidery mockup photo",
    );
    if (productId) {
      await ensureDefinitions(admin, session.shop);
      await setProductPhoto(admin, productId, img.id);
    }
    return { ok: true, productId: productId || null, ...img };
  } catch (e: any) {
    console.error("[photos] upload failed", e);
    return { ok: false, error: e?.message ?? "Upload failed" };
  }
};
