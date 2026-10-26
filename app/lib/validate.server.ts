import type { AdminLike } from "./files.server";
import { getMethod } from "./methods.server";
import { priceFor, type MethodData } from "./methods";
import { productTemplates } from "./templates.server";
import { zoneBoxInches, type Zone } from "./templates";

// Check a submitted design against its method and the product's location template, and price it.
// The builder enforces the same rules; this stops a tampered request from getting a wrong price.
export async function checkDesign(admin: AdminLike, shop: string, spec: any) {
  const d = spec?.decorations?.[0];
  const quantity = Math.max(1, Math.min(100000, parseInt(spec?.quantity, 10) || 1));
  const fail = (error: string) => ({ ok: false as const, error });
  if (!d?.method?.key) return fail("Please choose how to apply your logo.");
  const method: MethodData | null = await getMethod(shop, String(d.method.key));
  if (!method || !method.enabled) return fail("That customization method isn't available right now.");

  const templates = await productTemplates(admin, spec?.product?.id ?? "").catch(() => []);
  let zone: Zone | null = null;
  if (templates.length) {
    const t = templates.find((x) => x.method === method.key);
    if (!t) return fail(`${method.name} isn't offered on this apron.`);
    zone = t.zones.find((z) => z.id === d?.zone?.id) ?? null;
    if (!zone) return fail("Please choose a location again; this one isn't available.");
    const box = zoneBoxInches(zone, t);
    const maxW = Math.min(zone.maxW || box.w, box.w), maxH = Math.min(zone.maxH || box.h, box.h);
    const w = Number(d?.size?.widthIn) || 0, h = Number(d?.size?.heightIn) || 0;
    if (w > maxW + 0.06 || h > maxH + 0.06) return fail(`Your logo is larger than ${zone.label} allows (${maxW.toFixed(1)}″ × ${maxH.toFixed(1)}″).`);
    if (zone.minW && w < zone.minW - 0.06) return fail(`${zone.label} needs a logo at least ${zone.minW}″ wide.`);
  } else if (method.key !== "standard_embroidery") {
    return fail(`${method.name} isn't offered on this apron.`);
  }

  const colors = Math.max(1, Math.min(30, parseInt(d?.colorCount, 10) || 1));
  const customColors = Math.max(0, Math.min(colors, parseInt(d?.customColorCount, 10) || 0));
  // The location's own limit wins; otherwise the method default.
  const maxColors = zone?.maxColors || method.maxColors || Infinity;
  if (colors > maxColors) return fail(`${zone?.label ?? "This location"} allows up to ${maxColors} colors for ${method.name.toLowerCase()}.`);
  // Stitches come from the builder's estimate (charged as final).
  const stitches = method.kind === "embroidery" ? Math.max(500, Number(d?.estimate?.stitches) || 0) : 0;
  if (zone?.maxStitches && stitches > zone.maxStitches) return fail(`That design needs more stitches than ${zone.label} allows. Try a smaller logo.`);
  // The location's own minimum wins; otherwise the method minimum.
  const minimum = zone?.minQty || method.minimum;
  if (quantity < minimum) return fail(zone?.minQty ? `${zone.label} has a ${minimum}-apron minimum for ${method.name.toLowerCase()}.` : `${method.name} has a ${minimum}-apron minimum.`);
  if (zone?.qtyStep && zone.qtyStep > 1 && quantity % zone.qtyStep) return fail(`${zone.label} is ordered in multiples of ${zone.qtyStep}.`);

  const price = priceFor(method, { quantity, stitches, colors, customColors });
  return { ok: true as const, method, zone, quantity, stitches, colors, customColors, price };
}
