import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fileUrls } from "../lib/files.server";
import { signedUrl } from "../lib/design.server";
import { STAGES, stageLabel } from "../lib/stages";
import { firstDecoration } from "../lib/spec";

// Design center: every customer design with its mockup, workflow stage and payment status.

const OPEN = ["new", "in_review", "proof_sent", "changes_requested", "approved", "in_production"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "open";
  const q = (url.searchParams.get("q") || "").trim();

  const where: any = { shop: session.shop };
  if (tab === "open") where.stage = { in: OPEN };
  else if (tab === "attention") where.attention = true;
  else if (tab !== "all") where.stage = tab;
  if (q) {
    const n = parseInt(q.replace(/^emb-?/i, ""), 10);
    where.OR = [
      ...(isFinite(n) ? [{ number: n }] : []),
      { email: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { productTitle: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, grouped, attention] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: [{ attention: "desc" }, { createdAt: "desc" }],
      take: 120,
      select: {
        id: true, number: true, createdAt: true, updatedAt: true, stage: true, attention: true, customerName: true,
        email: true, company: true, draftOrderId: true, productTitle: true, variantTitle: true, zoneLabel: true,
        quantity: true, estTotal: true, mockupFileId: true, proofFileId: true, spec: true,
      },
    }),
    prisma.submission.groupBy({ by: ["stage"], where: { shop: session.shop }, _count: { _all: true } }),
    prisma.submission.count({ where: { shop: session.shop, attention: true } }),
  ]);

  // Payment status from the draft orders (paid = checkout completed into an order).
  const draftIds = rows.map((r) => r.draftOrderId).filter(Boolean) as string[];
  const paid: Record<string, string> = {};
  if (draftIds.length) {
    try {
      const res = await admin.graphql(
        `#graphql
        query draftStatuses($ids: [ID!]!) { nodes(ids: $ids) { id ... on DraftOrder { status order { name } } } }`,
        { variables: { ids: draftIds } },
      );
      const json = (await res.json()) as any;
      for (const n of json?.data?.nodes ?? []) if (n?.status === "COMPLETED") paid[n.id] = n.order?.name ?? "";
    } catch {
      // leave unpaid
    }
  }
  const cdn = await fileUrls(admin, rows.map((r) => r.mockupFileId ?? "")).catch(() => ({}) as Record<string, string | null>);

  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.stage] = g._count._all;
  counts.open = OPEN.reduce((a, s) => a + (counts[s] ?? 0), 0);
  counts.all = grouped.reduce((a, g) => a + g._count._all, 0);
  counts.attention = attention;

  return {
    tab,
    q,
    counts,
    rows: rows.map((r) => {
      const sp = (r.spec ?? {}) as any;
      const img = r.mockupFileId ? cdn[r.mockupFileId] : null;
      return {
        id: r.id,
        ref: `EMB-${r.number}`,
        createdAt: r.createdAt.toISOString(),
        stage: r.stage,
        attention: r.attention,
        customer: r.customerName || r.email || "",
        company: r.company,
        product: [r.productTitle, r.variantTitle].filter(Boolean).join(" · "),
        zone: r.zoneLabel,
        method: firstDecoration(sp)?.method.name ?? "",
        size: firstDecoration(sp)?.size ? `${firstDecoration(sp)!.size!.widthIn}″ × ${firstDecoration(sp)!.size!.heightIn}″` : "",
        stitches: firstDecoration(sp)?.estimate?.stitches ?? null,
        colors: (firstDecoration(sp)?.colors ?? []).map((c: any) => c.hex as string),
        quantity: r.quantity,
        total: r.estTotal,
        paid: r.draftOrderId ? r.draftOrderId in paid : false,
        orderName: r.draftOrderId ? paid[r.draftOrderId] ?? null : null,
        thumb: img ? `${img}${img.includes("?") ? "&" : "?"}width=480` : signedUrl(r.id, "mockup"),
        hasProof: !!r.proofFileId,
      };
    }),
  };
};

const TONE: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.tone]));
const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));

export default function DesignCenter() {
  const { rows, counts, tab, q } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const tabs = [
    { id: "open", label: "Open" },
    { id: "attention", label: "Needs reply" },
    ...STAGES.map((s) => ({ id: s.id, label: s.label })),
    { id: "all", label: "All" },
  ];
  const href = (t: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", t);
    return `?${p.toString()}`;
  };

  return (
    <s-page heading="Design center">
      <div className="dc-bar">
        <nav className="dc-tabs" aria-label="Filter designs">
          {tabs.map((t) => (
            <Link key={t.id} to={href(t.id)} className={t.id === tab ? "is-on" : ""} aria-current={t.id === tab ? "page" : undefined}>
              {t.label}
              <span>{counts[t.id] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <Form method="get" className="dc-search">
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} placeholder="Search EMB number, customer, email, apron" aria-label="Search designs" />
        </Form>
      </div>

      {rows.length === 0 ? (
        <s-section>
          <s-paragraph>
            {counts.all === 0
              ? "No designs yet. When a customer creates a design with the product page builder, it shows up here with the mockup, logo, stitch estimate and colors."
              : "No designs match this view."}
          </s-paragraph>
        </s-section>
      ) : (
        <div className="dc-grid">
          {rows.map((r) => (
            <Link key={r.id} to={`/app/submissions/${r.id}`} className={`dc-card${r.attention ? " is-attn" : ""}`}>
              <div className="dc-img">
                <img src={r.thumb} alt={`${r.ref} mockup`} loading="lazy" />
                {r.attention ? <span className="dc-flag">Needs reply</span> : null}
              </div>
              <div className="dc-body">
                <div className="dc-top">
                  <strong>{r.ref}</strong>
                  <span className={`dc-badge tone-${TONE[r.stage] ?? "neutral"}`}>{stageLabel(r.stage)}</span>
                </div>
                <div className="dc-line">{r.customer || "Customer at checkout"}{r.company ? ` · ${r.company}` : ""}</div>
                <div className="dc-line"><span className="dc-method">{r.method}</span> {r.product}</div>
                <div className="dc-line dc-muted">
                  {r.zone} {r.size ? `· ${r.size}` : ""} {r.stitches ? `· ≈${(Math.round(r.stitches / 100) * 100).toLocaleString()} stitches` : ""}
                </div>
                <div className="dc-foot">
                  <span className="dc-swatches">
                    {r.colors.slice(0, 8).map((c: string, i: number) => (
                      <i key={i} style={{ background: c }} title={c} />
                    ))}
                  </span>
                  <span className={r.paid ? "dc-paid" : "dc-unpaid"}>{r.paid ? `Paid ${r.orderName ?? ""}` : "Not paid"}</span>
                </div>
                <div className="dc-line dc-muted">
                  {r.quantity} aprons · {money(r.total)} embroidery · {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <style>{`
        .dc-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
        .dc-tabs{display:flex;flex-wrap:wrap;gap:6px}
        .dc-tabs a{display:inline-flex;gap:6px;align-items:center;padding:6px 10px;border-radius:8px;color:#303030;text-decoration:none;font-size:13px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
        .dc-tabs a span{background:#ebebeb;border-radius:10px;padding:0 6px;font-size:12px}
        .dc-tabs a.is-on{background:#303030;color:#fff}
        .dc-tabs a.is-on span{background:#616161;color:#fff}
        .dc-search input{font:inherit;font-size:13px;padding:7px 10px;border:1px solid #8a8a8a;border-radius:8px;min-width:280px}
        .dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
        .dc-card{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06)}
        .dc-card:hover{box-shadow:0 0 0 2px #005bd3}
        .dc-card.is-attn{box-shadow:0 0 0 2px #e51c00}
        .dc-img{position:relative;height:260px;background:#f1f1f1;display:flex;align-items:center;justify-content:center}
        .dc-img img{max-width:100%;max-height:100%;object-fit:contain}
        .dc-flag{position:absolute;top:8px;left:8px;background:#e51c00;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}
        .dc-body{padding:12px;display:flex;flex-direction:column;gap:4px;font-size:13px}
        .dc-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
        .dc-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dc-muted{color:#616161}
        .dc-method{font-size:11px;font-weight:600;background:#f1f1f1;border-radius:6px;padding:1px 6px;margin-right:4px}
        .dc-foot{display:flex;justify-content:space-between;align-items:center;margin-top:4px}
        .dc-swatches{display:flex;gap:3px}
        .dc-swatches i{width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.2);display:inline-block}
        .dc-paid{color:#0c5132;background:#cdfee1;border-radius:8px;padding:1px 8px;font-size:12px}
        .dc-unpaid{color:#4f4700;background:#fff1c2;border-radius:8px;padding:1px 8px;font-size:12px}
        .dc-badge{font-size:12px;border-radius:8px;padding:1px 8px;background:#ebebeb}
        .dc-badge.tone-info{background:#e0f0ff;color:#00527c}
        .dc-badge.tone-warning{background:#fff1c2;color:#4f4700}
        .dc-badge.tone-critical{background:#fee9e8;color:#8e1f0b}
        .dc-badge.tone-success{background:#cdfee1;color:#0c5132}
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
