import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { uploadToShopifyFiles } from "../lib/files.server";
import { createCheckout } from "../lib/checkout.server";
import { checkDesign } from "../lib/validate.server";
import { firstDecoration } from "../lib/spec";
import { addEvent, customerLink, newToken } from "../lib/design.server";

// Storefront submission: POST https://<shop>/apps/imprint/submit (multipart form).
// Saves the design, then creates a draft order priced on the server and returns its checkout link.
// Fields: logo (file), mockup (png), spec (JSON), email (optional), notes, rights.

const MAX_LOGO = 20 * 1024 * 1024;
const MAX_MOCKUP = 8 * 1024 * 1024;

// Errors go back with status 200: Shopify's app proxy replaces error statuses with its own
// page, which would hide the message from the customer.
function bad(error: string, _status = 400) {
  return Response.json({ ok: false, error }, { status: 200 });
}
function str(v: FormDataEntryValue | null, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export const loader = () => bad("Use POST", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return bad("This store hasn't finished installing the app.", 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("We couldn't read the upload. Please try again.");
  }

  const logo = form.get("logo");
  const mockup = form.get("mockup");
  const artwork = form.get("artwork");
  const name = str(form.get("name"), 200);
  const email = str(form.get("email"), 200);
  if (!(logo instanceof File) || logo.size === 0) return bad("Please upload your logo.");
  if (logo.size > MAX_LOGO) return bad("That logo file is over 20 MB.");
  if (email && !/.+@.+\..+/.test(email)) return bad("Please check your email address.");
  if (str(form.get("rights")) !== "yes") return bad("Please confirm you have the rights to use this logo.");

  let spec: any;
  try {
    spec = JSON.parse(str(form.get("spec"), 100_000) || "{}");
  } catch {
    return bad("Design details were missing. Please try again.");
  }
  if (!spec?.variant?.id) return bad("Please choose an apron color.");
  if (spec?.version !== 2 || !Array.isArray(spec?.decorations)) return bad("Please reload the page and try again; the customizer was updated.");
  // Price on the server from the method and check the location's limits.
  const checked = await checkDesign(admin, session.shop, spec);
  if (!checked.ok) return bad(checked.error);
  const { method, quantity, stitches, price } = checked;
  spec.serverPrice = price;
  const deco = firstDecoration(spec)!;

  const logoBytes = new Uint8Array(await logo.arrayBuffer());
  const mockupBytes =
    mockup instanceof File && mockup.size > 0 && mockup.size <= MAX_MOCKUP
      ? new Uint8Array(await mockup.arrayBuffer())
      : null;
  const artworkBytes =
    artwork instanceof File && artwork.size > 0 && artwork.size <= MAX_MOCKUP
      ? new Uint8Array(await artwork.arrayBuffer())
      : null;
  const token = newToken();

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
      zoneLabel: deco.zone?.label ?? null,
      quantity,
      estTotal: price.total,
      spec,
      logoName: logo.name.slice(0, 200),
      logoType: logo.type || "application/octet-stream",
      token,
    },
  });
  const ref = `EMB-${sub.number}`;
  const designUrl = customerLink(session.shop, token);
  await addEvent(sub.id, `Design submitted from the product page (${method.name}, ${spec?.product?.title ?? "apron"}).`, "customer").catch(() => {});

  // Files go to Shopify Files; if that fails, keep the bytes in the database instead.
  const update: Record<string, unknown> = {};
  {
    try {
      update.logoFileId = await uploadToShopifyFiles(
        admin,
        { name: `${ref}-logo-${logo.name}`, type: logo.type, bytes: logoBytes },
        `${ref} logo${name ? ` from ${name}` : ""}`,
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
    if (artworkBytes) {
      try {
        update.artworkFileId = await uploadToShopifyFiles(
          admin,
          { name: `${ref}-artwork.png`, type: "image/png", bytes: artworkBytes },
          `${ref} artwork`,
        );
      } catch (e) {
        console.error(`[${ref}] artwork upload failed`, e);
        update.artworkData = Buffer.from(artworkBytes);
      }
    }
  }

  let checkoutUrl: string;
  try {
    const colorsLabel = deco.colors
      .map((c: any) => (c?.pantone ? `${c.pantone} (${c.hex})` : c?.hex))
      .filter(Boolean)
      .join(", ");
    const co = await createCheckout(admin, {
      ref,
      email,
      name,
      variantId: spec.variant.id,
      quantity,
      methodName: method.name,
      methodKind: method.kind,
      zoneLabel: String(deco.zone?.label ?? "Logo"),
      sizeLabel: `${deco.size?.widthIn ?? "?"}″ × ${deco.size?.heightIn ?? "?"}″`,
      colorsLabel,
      stitches,
      perApron: price.perPiece,
      setupFee: price.setupFee,
      designUrl,
    });
    update.draftOrderId = co.draftOrderId;
    update.checkoutUrl = co.checkoutUrl;
    update.status = "awaiting_payment";
    checkoutUrl = co.checkoutUrl;
  } catch (e) {
    console.error(`[${ref}] checkout creation failed`, e);
    update.status = "checkout_failed";
    await prisma.submission.update({ where: { id: sub.id }, data: update });
    return bad(`We saved your design (${ref}) but couldn't start checkout. Please contact us and mention ${ref}.`, 502);
  }
  await prisma.submission.update({ where: { id: sub.id }, data: update });

  return Response.json({ ok: true, reference: ref, checkoutUrl, designUrl });
};
