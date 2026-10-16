import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fileUrls } from "../lib/files.server";
import { draftOrderStatus } from "../lib/checkout.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const s = await prisma.submission.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!s) throw new Response("Not found", { status: 404 });

  const urls = await fileUrls(admin, [s.logoFileId ?? "", s.mockupFileId ?? ""]).catch(() => ({}) as Record<string, string | null>);
  const payment = s.draftOrderId ? await draftOrderStatus(admin, s.draftOrderId).catch(() => null) : null;
  const dataUrl = (b: Uint8Array | null, type: string) =>
    b ? `data:${type};base64,${Buffer.from(b).toString("base64")}` : null;

  return {
    ref: `EMB-${s.number}`,
    createdAt: s.createdAt.toISOString(),
    customer: { name: s.customerName, email: s.email, phone: s.phone, company: s.company, notes: s.notes },
    spec: s.spec as any,
    logoName: s.logoName,
    logoUrl: (s.logoFileId && urls[s.logoFileId]) || dataUrl(s.logoData, s.logoType),
    logoPending: !!s.logoFileId && !urls[s.logoFileId],
    mockupUrl: (s.mockupFileId && urls[s.mockupFileId]) || dataUrl(s.mockupData, "image/png"),
    mockupPending: !!s.mockupFileId && !urls[s.mockupFileId],
    status: s.status,
    checkoutUrl: s.checkoutUrl,
    payment,
  };
};

const money = (n: number | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function SubmissionDetail() {
  const d = useLoaderData<typeof loader>();
  const sp = d.spec ?? {};
  const rows: [string, string][] = [
    ["Apron", `${sp.product?.title ?? "—"}${sp.variant?.title ? ` · ${sp.variant.title}` : ""}`],
    ["Location", sp.zone?.label ?? "—"],
    ["Logo size", sp.size ? `${sp.size.widthIn}″ × ${sp.size.heightIn}″` : "—"],
    ["Position", sp.position ? `center ${sp.position.centerXIn}″ from left, ${sp.position.centerYIn}″ from top of the ${sp.position.zoneWidthIn}″ × ${sp.position.zoneHeightIn}″ area` : "—"],
    ["Est. stitches", sp.estimate ? `≈ ${sp.estimate.stitches.toLocaleString()} (range ${sp.estimate.low.toLocaleString()}–${sp.estimate.high.toLocaleString()})` : "—"],
    ["Quantity", String(sp.quantity ?? "—")],
    ["Est. embroidery", money(sp.price?.total)],
  ];
  return (
    <s-page heading={d.ref}>
      <s-link slot="breadcrumb-actions" href="/app">Submissions</s-link>
      <s-section heading="Mockup">
        {d.mockupUrl ? (
          <s-image src={d.mockupUrl} alt={`${d.ref} mockup`} aspectRatio="3/4" objectFit="contain" />
        ) : (
          <s-paragraph>{d.mockupPending ? "The mockup is still processing in Shopify Files. Refresh in a moment." : "No mockup was sent."}</s-paragraph>
        )}
      </s-section>
      <s-section heading="Design">
        <s-table>
          <s-table-body>
            {rows.map(([k, v]) => (
              <s-table-row key={k}>
                <s-table-cell>{k}</s-table-cell>
                <s-table-cell>{v}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      <s-section heading="Thread colors">
        <s-table>
          <s-table-header-row>
            <s-table-header>Hex</s-table-header>
            <s-table-header>Pantone</s-table-header>
            <s-table-header>Detected from logo</s-table-header>
            <s-table-header format="numeric">Share</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(sp.colors ?? []).map((c: any, i: number) => (
              <s-table-row key={i}>
                <s-table-cell>{c.hex}</s-table-cell>
                <s-table-cell>{c.pantone || "—"}</s-table-cell>
                <s-table-cell>{c.detected}</s-table-cell>
                <s-table-cell>{Math.round((c.share ?? 0) * 100)}%</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      <s-section slot="aside" heading="Payment">
        {d.payment?.status === "COMPLETED" ? (
          <s-paragraph>
            <s-badge tone="success">Paid</s-badge> Order {d.payment.orderName ?? ""}
          </s-paragraph>
        ) : d.payment ? (
          <s-paragraph>
            <s-badge tone="warning">Not paid yet</s-badge> Checkout started; the customer hasn't paid.
          </s-paragraph>
        ) : (
          <s-paragraph>
            <s-badge tone="critical">No checkout</s-badge> {d.status === "checkout_failed" ? "Checkout couldn't be created. Follow up with the customer." : "No checkout was created."}
          </s-paragraph>
        )}
        {d.payment?.total ? (
          <s-paragraph>
            Total {Number(d.payment.total.amount).toLocaleString("en-US", { style: "currency", currency: d.payment.total.currencyCode })}
          </s-paragraph>
        ) : null}
        {d.checkoutUrl && d.payment?.status !== "COMPLETED" ? (
          <s-link href={d.checkoutUrl} target="_blank">Checkout link</s-link>
        ) : null}
      </s-section>
      <s-section slot="aside" heading="Customer">
        <s-paragraph>{d.customer.name}{d.customer.company ? ` · ${d.customer.company}` : ""}</s-paragraph>
        <s-paragraph><s-link href={`mailto:${d.customer.email}`}>{d.customer.email}</s-link></s-paragraph>
        {d.customer.phone ? <s-paragraph>{d.customer.phone}</s-paragraph> : null}
        {d.customer.notes ? <s-paragraph>Notes: {d.customer.notes}</s-paragraph> : null}
        <s-paragraph>Received {new Date(d.createdAt).toLocaleString()}</s-paragraph>
      </s-section>
      <s-section slot="aside" heading="Original logo file">
        <s-paragraph>{d.logoName}</s-paragraph>
        {d.logoUrl ? (
          <s-link href={d.logoUrl} target="_blank">Download original</s-link>
        ) : (
          <s-paragraph>{d.logoPending ? "Still processing in Shopify Files. Refresh in a moment." : "Not available."}</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
