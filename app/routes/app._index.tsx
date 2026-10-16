import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const rows = await prisma.submission.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, number: true, createdAt: true, status: true, customerName: true, email: true,
      company: true, draftOrderId: true, productTitle: true, variantTitle: true, zoneLabel: true, quantity: true, estTotal: true,
    },
  });
  // Live payment status from the draft orders (paid = draft completed into an order).
  const ids = rows.map((r) => r.draftOrderId).filter(Boolean) as string[];
  const paid: Record<string, string> = {};
  if (ids.length) {
    try {
      const res = await admin.graphql(
        `#graphql
        query draftStatuses($ids: [ID!]!) { nodes(ids: $ids) { id ... on DraftOrder { status order { name } } } }`,
        { variables: { ids } },
      );
      const json = (await res.json()) as any;
      for (const n of json?.data?.nodes ?? []) if (n?.status === "COMPLETED") paid[n.id] = n.order?.name ?? "";
    } catch {
      // status falls back to the stored value
    }
  }
  return {
    rows: rows.map(({ draftOrderId, ...r }) => ({
      ...r,
      status: draftOrderId && draftOrderId in paid ? "paid" : r.status,
      orderName: draftOrderId ? paid[draftOrderId] ?? null : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
};

const STATUS: Record<string, string> = {
  new: "New",
  awaiting_payment: "Checkout started",
  checkout_failed: "Checkout failed",
  paid: "Paid",
};

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function Submissions() {
  const { rows } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Embroidery submissions">
      {rows.length === 0 ? (
        <s-section>
          <s-paragraph>
            No designs yet. When a customer submits a design from the product
            page builder, it appears here with their logo, mockup and specs.
          </s-paragraph>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header>Reference</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Received</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Apron</s-table-header>
              <s-table-header>Location</s-table-header>
              <s-table-header format="numeric">Qty</s-table-header>
              <s-table-header format="numeric">Est. embroidery</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`/app/submissions/${r.id}`}>EMB-{r.number}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {STATUS[r.status] ?? r.status}
                    {r.orderName ? ` · ${r.orderName}` : ""}
                  </s-table-cell>
                  <s-table-cell>{new Date(r.createdAt).toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    {r.customerName}
                    {r.company ? ` · ${r.company}` : ""}
                  </s-table-cell>
                  <s-table-cell>
                    {r.productTitle ?? "—"}
                    {r.variantTitle ? ` · ${r.variantTitle}` : ""}
                  </s-table-cell>
                  <s-table-cell>{r.zoneLabel ?? "—"}</s-table-cell>
                  <s-table-cell>{r.quantity}</s-table-cell>
                  <s-table-cell>{money(r.estTotal)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
