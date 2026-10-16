import type { AdminLike } from "./files.server";

export type CheckoutInput = {
  ref: string;
  email: string;
  name: string;
  variantId: string | number;
  quantity: number;
  zoneLabel: string;
  sizeLabel: string;
  colorsLabel: string;
  stitches: number;
  perApron: number;
  setupFee: number;
};

// Create a draft order (aprons + embroidery + setup) and return its checkout link.
export async function createCheckout(admin: AdminLike, c: CheckoutInput) {
  const shopRes = await admin.graphql(`#graphql
    query shopCurrency { shop { currencyCode } }`);
  const currencyCode = ((await shopRes.json()) as any)?.data?.shop?.currencyCode ?? "USD";
  const money = (n: number) => ({ amount: n.toFixed(2), currencyCode });
  const design = { key: "Embroidery design", value: c.ref };

  const res = await admin.graphql(
    `#graphql
    mutation createCheckout($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          ...(c.email ? { email: c.email } : {}),
          note: `Custom embroidery design ${c.ref}. Mockup, logo and specs are in the Embroidery Builder app.`,
          tags: ["embroidery-builder", c.ref],
          lineItems: [
            {
              variantId: String(c.variantId).startsWith("gid://") ? c.variantId : `gid://shopify/ProductVariant/${c.variantId}`,
              quantity: c.quantity,
              customAttributes: [design],
            },
            {
              title: `Custom embroidery: ${c.zoneLabel} (${c.sizeLabel})`,
              originalUnitPriceWithCurrency: money(c.perApron),
              quantity: c.quantity,
              requiresShipping: false,
              taxable: true,
              customAttributes: [
                design,
                { key: "Location", value: c.zoneLabel },
                { key: "Size", value: c.sizeLabel },
                { key: "Colors", value: c.colorsLabel.slice(0, 250) },
                { key: "Est. stitches", value: String(Math.round(c.stitches)) },
              ],
            },
            {
              title: "Embroidery setup (one time)",
              originalUnitPriceWithCurrency: money(c.setupFee),
              quantity: 1,
              requiresShipping: false,
              taxable: true,
              customAttributes: [design],
            },
          ],
        },
      },
    },
  );
  const json = (await res.json()) as any;
  const errs = json?.data?.draftOrderCreate?.userErrors;
  if (errs?.length) throw new Error("draftOrderCreate: " + errs.map((e: any) => e.message).join("; "));
  const d = json?.data?.draftOrderCreate?.draftOrder;
  if (!d?.invoiceUrl) throw new Error("draftOrderCreate returned no checkout link");
  return { draftOrderId: d.id as string, checkoutUrl: d.invoiceUrl as string };
}

// Payment status for the admin: open (not paid yet) or completed (order created).
export async function draftOrderStatus(admin: AdminLike, id: string) {
  const res = await admin.graphql(
    `#graphql
    query draftStatus($id: ID!) {
      draftOrder(id: $id) { status totalPriceSet { shopMoney { amount currencyCode } } order { id name email customer { displayName } } }
    }`,
    { variables: { id } },
  );
  const d = ((await res.json()) as any)?.data?.draftOrder;
  if (!d) return null;
  return {
    status: d.status as string,
    total: d.totalPriceSet?.shopMoney as { amount: string; currencyCode: string } | undefined,
    orderName: (d.order?.name as string) ?? null,
    orderId: (d.order?.id as string) ?? null,
    orderEmail: (d.order?.email as string) ?? null,
    customerName: (d.order?.customer?.displayName as string) ?? null,
  };
}
