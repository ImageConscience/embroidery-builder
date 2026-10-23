import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { draftOrderStatus } from "../lib/checkout.server";
import { uploadToShopifyFiles } from "../lib/files.server";
import { ESTIMATOR } from "../lib/pricing.server";
import { getMethod } from "../lib/methods.server";
import { firstDecoration } from "../lib/spec";
import { addEvent, customerLink, ensureToken, fileLinks, signedUrl } from "../lib/design.server";
import { STAGES, isStage, stageLabel } from "../lib/stages";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const s = await prisma.submission.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!s) throw new Response("Not found", { status: 404 });
  const token = await ensureToken(s.id, s.token);
  const [links, payment] = await Promise.all([
    fileLinks(admin, s),
    s.draftOrderId ? draftOrderStatus(admin, s.draftOrderId).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    id: s.id,
    ref: `EMB-${s.number}`,
    createdAt: s.createdAt.toISOString(),
    stage: s.stage,
    attention: s.attention,
    customer: { name: s.customerName, email: s.email, phone: s.phone, company: s.company, notes: s.notes },
    spec: s.spec as any,
    logoName: s.logoName,
    links,
    proof: s.proofFileId || s.proofData ? { name: s.proofName, type: s.proofType, sentAt: s.proofSentAt?.toISOString() ?? null } : null,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    status: s.status,
    checkoutUrl: s.checkoutUrl,
    payment,
    customerUrl: customerLink(session.shop, token),
    packageUrl: signedUrl(s.id, "package", 3600, true),
    logoDownload: s.logoData ? `${signedUrl(s.id, "logo", 3600, true)}&download=1` : links.logo,
    messages: s.messages.map((m) => ({ id: m.id, kind: m.kind, author: m.author, authorName: m.authorName, body: m.body, createdAt: m.createdAt.toISOString() })),
    deco: firstDecoration(s.spec),
    pricing: await (async () => {
      const m = await getMethod(session.shop, firstDecoration(s.spec)?.method.key ?? "standard_embroidery");
      return { includedStitches: m?.includedStitches ?? 6000, includedColors: m?.includedColors ?? 4, perThousand: m?.perThousandStitches ?? 1, perExtraColor: m?.perExtraColor ?? 1, customColorFee: m?.customColorFee ?? 0 };
    })(),
    estimator: ESTIMATOR,
  };
};

const MAX_PROOF = 20 * 1024 * 1024;

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const s = await prisma.submission.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!s) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const ref = `EMB-${s.number}`;

  if (intent === "stage") {
    const stage = String(form.get("stage"));
    if (!isStage(stage)) return { ok: false, error: "Unknown status" };
    if (stage === s.stage) return { ok: true, message: "No change" };
    await prisma.submission.update({
      where: { id: s.id },
      data: {
        stage,
        attention: false,
        ...(stage === "approved" && !s.approvedAt ? { approvedAt: new Date() } : {}),
        ...(stage === "proof_sent" ? { proofSentAt: new Date() } : {}),
      },
    });
    await addEvent(s.id, `Status changed from ${stageLabel(s.stage)} to ${stageLabel(stage)}.`, "staff");
    return { ok: true, message: `Status: ${stageLabel(stage)}` };
  }

  if (intent === "message") {
    const body = String(form.get("body") || "").trim().slice(0, 5000);
    const kind = form.get("visibility") === "note" ? "note" : "message";
    if (!body) return { ok: false, error: "Write a message first." };
    await prisma.message.create({ data: { submissionId: s.id, kind, author: "staff", authorName: "ApronWarehouse team", body } });
    if (kind === "message") await prisma.submission.update({ where: { id: s.id }, data: { attention: false } });
    return { ok: true, message: kind === "note" ? "Note added" : "Message added to the customer's design page", reset: true };
  }

  if (intent === "resolve") {
    await prisma.submission.update({ where: { id: s.id }, data: { attention: false } });
    return { ok: true, message: "Marked as handled" };
  }

  if (intent === "proof") {
    const file = form.get("proof");
    if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a proof file to upload." };
    if (file.size > MAX_PROOF) return { ok: false, error: "That file is over 20 MB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data: Record<string, unknown> = { proofType: file.type || "application/octet-stream", proofName: file.name.slice(0, 200), proofFileId: null, proofData: null };
    try {
      data.proofFileId = await uploadToShopifyFiles(admin, { name: `${ref}-proof-${file.name}`, type: file.type, bytes }, `${ref} proof`);
    } catch (e) {
      console.error(`[${ref}] proof upload failed`, e);
      data.proofData = Buffer.from(bytes);
    }
    const send = form.get("send") === "yes";
    if (send) Object.assign(data, { stage: "proof_sent", proofSentAt: new Date(), attention: false });
    await prisma.submission.update({ where: { id: s.id }, data });
    await addEvent(s.id, send ? `Proof uploaded (${file.name}) and marked as sent.` : `Proof uploaded (${file.name}).`, "staff");
    return { ok: true, message: send ? "Proof uploaded. Send the customer their design link." : "Proof uploaded" };
  }

  return { ok: false, error: "Unknown action" };
};

/* ---------------- page ---------------- */

const money = (n: number | undefined | null) => (n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmt = (n: number | undefined, d = 1) => (n == null ? "—" : Number(n).toFixed(d));

export default function DesignPage() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const msgForm = useRef<HTMLFormElement>(null);
  const proofForm = useRef<HTMLFormElement>(null);
  const sp = d.spec ?? {};
  const deco: any = d.deco ?? {};
  const isEmb = (deco.method?.kind ?? "embroidery") === "embroidery";
  const est = deco.estimate ?? {};
  const price = sp.serverPrice ?? {};
  const busy = nav.state !== "idle";

  useEffect(() => {
    if (!result) return;
    if (result.ok && (result as any).message) shopify.toast.show((result as any).message);
    if (!result.ok && (result as any).error) shopify.toast.show((result as any).error, { isError: true });
    if ((result as any).reset) msgForm.current?.reset();
    if (result.ok) proofForm.current?.reset();
  }, [result]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      shopify.toast.show("Link copied");
    } catch {
      window.prompt("Copy this link", text);
    }
  };

  const est_ = d.estimator;
  const breakdown: [string, string, string][] = est.stitches
    ? [
        ["Fill areas", `${fmt(est.fillSqIn, 2)} sq in`, `≈ ${Math.round((est.fillSqIn ?? 0) * est_.fillPerSqIn).toLocaleString()}`],
        ["Satin (narrow) areas", `${fmt(est.satinSqIn, 2)} sq in`, `≈ ${Math.round((est.satinSqIn ?? 0) * est_.satinPerSqIn).toLocaleString()}`],
        ["Outlines", `${fmt(est.outlineIn, 1)} in`, `≈ ${Math.round((est.outlineIn ?? 0) * est_.runPerIn).toLocaleString()}`],
        ["Color changes", `${deco.colorCount ?? 0}`, `≈ ${((deco.colorCount ?? 0) * est_.perColor).toLocaleString()}`],
        ["Base (tie-ins, trims)", "", `≈ ${est_.base}`],
      ]
    : [];

  const designRows: [string, string][] = [
    ["Apron", `${sp.product?.title ?? "—"}${sp.variant?.title ? ` · ${sp.variant.title}` : ""}`],
    ["Method", deco.method?.name ?? "—"],
    ["Location", deco.zone?.label ?? "—"],
    ["Logo size", deco.size ? `${deco.size.widthIn}″ wide × ${deco.size.heightIn}″ tall` : "—"],
    ["Position", deco.position ? `Center ${deco.position.centerXIn}″ from left, ${deco.position.centerYIn}″ from top of the ${deco.position.zoneWidthIn}″ × ${deco.position.zoneHeightIn}″ area` : "—"],
    ["Background", deco.background === "kept" ? `Kept (${isEmb ? "stitched" : "printed"} as a solid fill)` : deco.background === "removed" ? `Removed${deco.insideAreasStitched ? ", inside areas filled" : ""}` : "None detected"],
    ["Quantity", String(sp.quantity ?? "—")],
  ];

  return (
    <s-page heading={`${d.ref} · ${stageLabel(d.stage)}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Design center
      </s-link>
      <s-button slot="secondary-actions" href={d.packageUrl} target="_blank">
        Download package
      </s-button>
      <s-button slot="secondary-actions" onClick={() => copy(d.customerUrl)}>
        Copy customer link
      </s-button>

      {d.attention ? (
        <s-banner tone="warning" heading="The customer is waiting on a reply">
          <s-paragraph>Reply below, change the status, or mark it handled.</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="resolve" />
            <button className="ds-link" type="submit">Mark handled</button>
          </Form>
        </s-banner>
      ) : null}

      <s-section heading="Mockup and proof">
        <div className="ds-images">
          <figure>
            {d.links.mockup ? <img src={d.links.mockup} alt={`${d.ref} mockup`} /> : <div className="ds-missing">{d.links.pending.mockup ? "Processing in Shopify Files…" : "No mockup"}</div>}
            <figcaption>Customer's mockup</figcaption>
          </figure>
          {d.links.artwork ? (
            <figure>
              <img src={d.links.artwork} alt={`${d.ref} artwork`} className="ds-checker" />
              <figcaption>Artwork in the chosen colors</figcaption>
            </figure>
          ) : null}
          {d.proof ? (
            <figure>
              {d.links.proof && /^image\//.test(d.proof.type ?? "") ? (
                <img src={d.links.proof} alt={`${d.ref} proof`} />
              ) : (
                <div className="ds-missing">{d.links.proof ? <a href={d.links.proof} target="_blank" rel="noreferrer">Open {d.proof.name}</a> : "Processing…"}</div>
              )}
              <figcaption>Proof{d.proof.sentAt ? ` · sent ${when(d.proof.sentAt)}` : ""}</figcaption>
            </figure>
          ) : null}
        </div>
      </s-section>

      <s-section heading="Design">
        <table className="ds-table">
          <tbody>
            {designRows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>

      <s-section heading="Thread colors">
        <table className="ds-table">
          <thead>
            <tr>
              <th></th>
              <th>Hex</th>
              <th>Pantone</th>
              <th>Detected in logo</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {(deco.colors ?? []).map((c: any, i: number) => (
              <tr key={i}>
                <td><span className="ds-sw" style={{ background: c.hex }} /></td>
                <td>{c.hex}</td>
                <td>{c.pantone || "—"}</td>
                <td>
                  <span className="ds-sw ds-sw-sm" style={{ background: c.detected }} /> {c.detected}
                </td>
                <td>{Math.round((c.share ?? 0) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ds-note">
          {deco.colorCount ?? 0} distinct colors · {d.pricing.includedColors} included{deco.customColorCount ? ` · ${deco.customColorCount} custom Pantone ink${deco.customColorCount === 1 ? "" : "s"}` : ""}
        </p>
      </s-section>

      <s-section heading={isEmb ? "Stitch estimate and price" : "Price"}>
        {est.stitches ? (
          <>
            <p className="ds-big">≈ {Math.round(est.stitches).toLocaleString()} stitches</p>
            <p className="ds-note">
              Likely range {Number(est.low).toLocaleString()}–{Number(est.high).toLocaleString()}. {d.pricing.includedStitches.toLocaleString()} included; the customer was charged for the estimate.
            </p>
            <table className="ds-table">
              <tbody>
                {breakdown.map(([k, a, b]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{a}</td>
                    <td className="ds-num">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : isEmb ? (
          <p className="ds-note">No estimate recorded.</p>
        ) : (
          <p className="ds-note">Logo size doesn't change the price for this method.</p>
        )}
        <table className="ds-table ds-price">
          <tbody>
            <tr><td>{deco.method?.name ?? "Embroidery"} per apron (tier)</td><td className="ds-num">{money(price.tierPrice ?? sp.price?.tierPrice)}</td></tr>
            {isEmb ? <tr><td>Extra stitches per apron</td><td className="ds-num">{price.extraK ? `${price.extraK}k × ${money(d.pricing.perThousand)}` : "—"}</td></tr> : null}
            {!isEmb && price.customColors ? <tr><td>Custom Pantone inks per apron</td><td className="ds-num">{`${price.customColors} × ${money(d.pricing.customColorFee)}`}</td></tr> : null}
            <tr><td>Extra colors per apron</td><td className="ds-num">{price.extraColors ? `${price.extraColors} × ${money(d.pricing.perExtraColor)}` : "—"}</td></tr>
            <tr><td>Per apron</td><td className="ds-num">{money(price.perPiece ?? price.perApron ?? sp.price?.perApron)}</td></tr>
            <tr><td>Setup (one time)</td><td className="ds-num">{money(price.setupFee ?? sp.price?.setupFee)}</td></tr>
            <tr className="ds-total"><td>{isEmb ? "Embroidery" : "Decoration"} total</td><td className="ds-num">{money(price.total ?? price.embroideryTotal ?? sp.price?.total)}</td></tr>
          </tbody>
        </table>
      </s-section>

      <s-section heading="Conversation and history">
        <ol className="ds-timeline">
          {d.messages.map((m) => (
            <li key={m.id} className={`ds-msg ds-${m.kind} ds-by-${m.author}`}>
              <div className="ds-meta">
                {m.kind === "event" ? "Update" : m.kind === "note" ? "Internal note" : m.author === "customer" ? "Customer" : m.authorName || "Team"}
                {" · "}
                {when(m.createdAt)}
              </div>
              <div className="ds-text">{m.body}</div>
            </li>
          ))}
        </ol>
        <Form method="post" ref={msgForm} className="ds-compose">
          <input type="hidden" name="intent" value="message" />
          <textarea name="body" rows={3} placeholder="Write to the customer, or add a note for your team" aria-label="Message" />
          <div className="ds-compose-row">
            <label><input type="radio" name="visibility" value="message" defaultChecked /> Message to customer (shows on their design page)</label>
            <label><input type="radio" name="visibility" value="note" /> Internal note</label>
            <button type="submit" className="ds-btn" disabled={busy}>Add</button>
          </div>
          <p className="ds-note">There's no automatic email yet. After writing, copy the customer link and send it from your email.</p>
        </Form>
      </s-section>

      <s-section slot="aside" heading="Status">
        <Form method="post" className="ds-stage">
          <input type="hidden" name="intent" value="stage" />
          <select name="stage" defaultValue={d.stage} key={d.stage} aria-label="Status">
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button type="submit" className="ds-btn" disabled={busy}>Update</button>
        </Form>
        {d.approvedAt ? <p className="ds-note">Customer approved {when(d.approvedAt)}</p> : null}
      </s-section>

      <s-section slot="aside" heading="Proof">
        <Form method="post" encType="multipart/form-data" ref={proofForm} className="ds-proof">
          <input type="hidden" name="intent" value="proof" />
          <input type="file" name="proof" accept="image/*,application/pdf" aria-label="Proof file" />
          <label><input type="checkbox" name="send" value="yes" defaultChecked /> Mark as sent and ask the customer to approve</label>
          <button type="submit" className="ds-btn" disabled={busy}>{d.proof ? "Replace proof" : "Upload proof"}</button>
        </Form>
        <p className="ds-note">The customer sees the proof on their design page and can approve it or ask for changes.</p>
      </s-section>

      <s-section slot="aside" heading="Customer design page">
        <p className="ds-note ds-break">{d.customerUrl}</p>
        <div className="ds-row">
          <button type="button" className="ds-btn" onClick={() => copy(d.customerUrl)}>Copy link</button>
          <a className="ds-btn" href={d.customerUrl} target="_blank" rel="noreferrer">Open</a>
        </div>
        <p className="ds-note">The link is also on the customer's order confirmation.</p>
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
        {(() => {
          const nm = d.payment?.customerName || d.customer.name;
          const em = d.payment?.orderEmail || d.customer.email;
          return (
            <>
              <s-paragraph>{nm || "Not known until checkout"}{d.customer.company ? ` · ${d.customer.company}` : ""}</s-paragraph>
              {em ? <s-paragraph><s-link href={`mailto:${em}?subject=${encodeURIComponent(`Your embroidery design ${d.ref}`)}&body=${encodeURIComponent(`You can see your design and proof here: ${d.customerUrl}`)}`}>{em}</s-link></s-paragraph> : null}
            </>
          );
        })()}
        {d.customer.phone ? <s-paragraph>{d.customer.phone}</s-paragraph> : null}
        {d.customer.notes ? <s-paragraph>Notes: {d.customer.notes}</s-paragraph> : null}
        <s-paragraph>Received {when(d.createdAt)}</s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Files">
        <p className="ds-note">Original: {d.logoName}</p>
        <div className="ds-files">
          {d.logoDownload ? <a href={d.logoDownload} target="_blank" rel="noreferrer">Original logo</a> : <span>Original logo processing…</span>}
          {d.links.artwork ? <a href={d.links.artwork} target="_blank" rel="noreferrer">Artwork PNG</a> : null}
          {d.links.mockup ? <a href={d.links.mockup} target="_blank" rel="noreferrer">Mockup PNG</a> : null}
          <a href={d.packageUrl} target="_blank" rel="noreferrer">Production package (.zip)</a>
        </div>
        <p className="ds-note">The package has the original logo, artwork, mockup, proof, a printable spec sheet and the specs as JSON.</p>
      </s-section>

      <style>{`
        .ds-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
        .ds-images figure{margin:0;background:#f1f1f1;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}
        .ds-images img{width:100%;max-height:460px;object-fit:contain;border-radius:6px}
        .ds-images figcaption{font-size:12px;color:#616161;text-align:center}
        .ds-checker{background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 50%/16px 16px}
        .ds-missing{min-height:200px;display:flex;align-items:center;justify-content:center;color:#616161;font-size:13px}
        .ds-table{width:100%;border-collapse:collapse;font-size:13px}
        .ds-table td,.ds-table th{text-align:left;padding:6px 8px;border-bottom:1px solid #ebebeb;vertical-align:top}
        .ds-table th{color:#616161;font-weight:500}
        .ds-table td:first-child{color:#616161}
        .ds-num{text-align:right!important;font-variant-numeric:tabular-nums}
        .ds-price{margin-top:12px}
        .ds-total td{font-weight:600;color:#303030!important}
        .ds-sw{display:inline-block;width:20px;height:20px;border-radius:50%;border:1px solid rgba(0,0,0,.25);vertical-align:middle}
        .ds-sw-sm{width:12px;height:12px}
        .ds-big{font-size:22px;font-weight:600;margin:0 0 4px}
        .ds-note{font-size:12px;color:#616161;margin:6px 0}
        .ds-break{word-break:break-all}
        .ds-timeline{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:8px}
        .ds-msg{border-radius:10px;padding:8px 12px;background:#f7f7f7;font-size:13px}
        .ds-msg.ds-by-customer{background:#eaf4ff}
        .ds-msg.ds-note{background:#fff8db}
        .ds-msg.ds-event{background:none;padding:2px 12px;color:#616161;font-size:12px}
        .ds-meta{font-size:12px;color:#616161;margin-bottom:2px}
        .ds-text{white-space:pre-wrap}
        .ds-compose textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:8px;border:1px solid #8a8a8a;border-radius:8px}
        .ds-compose-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:13px;margin-top:6px}
        .ds-compose-row .ds-btn{margin-left:auto}
        .ds-btn{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid #8a8a8a;background:#fff;cursor:pointer;color:#303030;text-decoration:none;display:inline-block}
        .ds-btn:disabled{opacity:.5}
        .ds-link{background:none;border:0;padding:0;color:#005bd3;text-decoration:underline;cursor:pointer;font:inherit}
        .ds-stage{display:flex;gap:8px}
        .ds-stage select{flex:1;font:inherit;font-size:13px;padding:6px;border:1px solid #8a8a8a;border-radius:8px}
        .ds-proof{display:flex;flex-direction:column;gap:8px;font-size:13px}
        .ds-row{display:flex;gap:8px}
        .ds-files{display:flex;flex-direction:column;gap:6px;font-size:13px}
        .ds-files a{color:#005bd3}
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
