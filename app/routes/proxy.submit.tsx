import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { uploadToShopifyFiles } from "../lib/files.server";

// Storefront submission: POST https://<shop>/apps/embroidery/submit (multipart form).
// Fields: logo (file), mockup (png), spec (JSON), name, email, phone, company, notes, rights.

const MAX_LOGO = 20 * 1024 * 1024;
const MAX_MOCKUP = 8 * 1024 * 1024;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}
function str(v: FormDataEntryValue | null, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export const loader = () => bad("Use POST", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) return bad("This store hasn't finished installing the app.", 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("We couldn't read the upload. Please try again.");
  }

  const logo = form.get("logo");
  const mockup = form.get("mockup");
  const name = str(form.get("name"), 200);
  const email = str(form.get("email"), 200);
  if (!(logo instanceof File) || logo.size === 0) return bad("Please upload your logo.");
  if (logo.size > MAX_LOGO) return bad("That logo file is over 20 MB.");
  if (!name || !/.+@.+\..+/.test(email)) return bad("Please enter your name and email.");
  if (str(form.get("rights")) !== "yes") return bad("Please confirm you have the rights to use this logo.");

  let spec: any;
  try {
    spec = JSON.parse(str(form.get("spec"), 100_000) || "{}");
  } catch {
    return bad("Design details were missing. Please try again.");
  }
  const quantity = Math.max(1, Math.min(100000, parseInt(spec?.quantity, 10) || 1));

  const logoBytes = new Uint8Array(await logo.arrayBuffer());
  const mockupBytes =
    mockup instanceof File && mockup.size > 0 && mockup.size <= MAX_MOCKUP
      ? new Uint8Array(await mockup.arrayBuffer())
      : null;

  const sub = await prisma.submission.create({
    data: {
      shop: session.shop,
      customerName: name,
      email,
      phone: str(form.get("phone"), 60) || null,
      company: str(form.get("company"), 200) || null,
      notes: str(form.get("notes"), 4000) || null,
      productTitle: spec?.product?.title ?? null,
      variantTitle: spec?.variant?.title ?? null,
      zoneLabel: spec?.zone?.label ?? null,
      quantity,
      estTotal: typeof spec?.price?.total === "number" ? spec.price.total : null,
      spec,
      logoName: logo.name.slice(0, 200),
      logoType: logo.type || "application/octet-stream",
    },
  });
  const ref = `EMB-${sub.number}`;

  // Files go to Shopify Files; if that fails, keep the bytes in the database instead.
  const update: Record<string, unknown> = {};
  if (admin) {
    try {
      update.logoFileId = await uploadToShopifyFiles(
        admin,
        { name: `${ref}-logo-${logo.name}`, type: logo.type, bytes: logoBytes },
        `${ref} logo from ${name}`,
      );
    } catch (e) {
      console.error(`[${ref}] logo upload failed`, e);
      update.logoData = Buffer.from(logoBytes);
    }
    if (mockupBytes) {
      try {
        update.mockupFileId = await uploadToShopifyFiles(
          admin,
          { name: `${ref}-mockup.png`, type: "image/png", bytes: mockupBytes },
          `${ref} mockup`,
        );
      } catch (e) {
        console.error(`[${ref}] mockup upload failed`, e);
        update.mockupData = Buffer.from(mockupBytes);
      }
    }
  } else {
    update.logoData = Buffer.from(logoBytes);
    if (mockupBytes) update.mockupData = Buffer.from(mockupBytes);
  }
  await prisma.submission.update({ where: { id: sub.id }, data: update });

  return Response.json({ ok: true, reference: ref });
};
