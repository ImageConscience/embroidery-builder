import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { draftOrderStatus } from "../lib/checkout.server";
import { addEvent, fileLinks, stageLabel } from "../lib/design.server";

// The customer's design page: https://<shop>/apps/embroidery/design/<token>
// Rendered by the store theme (Liquid response through the app proxy). Shows the mockup or proof,
// the specs and the conversation, and lets the customer approve the proof, ask for changes or write to the team.

// Escape for HTML, and also { } so nothing the customer typed can be read as Liquid.
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"'{}%]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;", "%": "&#37;" })[c]!,
  );
const when = (d: Date) => d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" });
const liquid = (html: string, status = 200) =>
  new Response(html, { status, headers: { "Content-Type": "application/liquid; charset=utf-8" } });

function page(title: string, body: string) {
  return `<div class="embd">
<style>
.embd{max-width:1040px;margin:32px auto;padding:0 16px;font-size:16px;line-height:1.5}
.embd h1{font-size:28px;margin:0 0 4px}
.embd .muted{opacity:.7}
.embd .grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:32px;margin-top:24px;align-items:start}
@media (max-width:760px){.embd .grid{grid-template-columns:1fr}}
.embd figure{margin:0;background:#f4f2ee;border-radius:12px;padding:12px;text-align:center}
.embd figure img{max-width:100%;max-height:640px;object-fit:contain;border-radius:8px}
.embd figcaption{font-size:13px;opacity:.7;margin-top:6px}
.embd table{width:100%;border-collapse:collapse;font-size:15px}
.embd td{padding:7px 0;border-bottom:1px solid rgba(0,0,0,.08);vertical-align:top}
.embd td:first-child{opacity:.7;width:40%}
.embd .sw{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.25);vertical-align:-2px;margin-right:4px}
.embd .status{border-radius:12px;padding:14px 16px;margin:16px 0;background:#eef4fb}
.embd .status.ok{background:#e7f6ec}.embd .status.act{background:#fff6dc}
.embd .btn{display:inline-block;padding:12px 20px;border-radius:8px;border:0;font:inherit;font-weight:600;cursor:pointer;background:#1f2a36;color:#fff;text-decoration:none}
.embd .btn.alt{background:#fff;color:#1f2a36;border:1px solid #1f2a36}
.embd textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid rgba(0,0,0,.3);border-radius:8px;margin:8px 0}
.embd .thread{list-style:none;padding:0;margin:16px 0;display:flex;flex-direction:column;gap:10px}
.embd .thread li{border-radius:10px;padding:10px 14px;background:#f4f2ee;max-width:85%}
.embd .thread li.me{background:#e8f0fa;align-self:flex-end}
.embd .thread .who{font-size:12px;opacity:.7}
.embd .thread .txt{white-space:pre-wrap}
.embd .actions{display:flex;flex-direction:column;gap:12px;margin:12px 0}
.embd details{border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:10px 14px}
.embd summary{cursor:pointer;font-weight:600}
.embd .note{font-size:13px;opacity:.75}
</style>
<h1>${esc(title)}</h1>
${body}
</div>`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  const token = params.token ?? "";
  const s =
    token.length >= 16 && session
      ? await prisma.submission.findFirst({
          where: { token, shop: session.shop },
          include: { messages: { where: { kind: "message" }, orderBy: { createdAt: "asc" } } },
        })
      : null;
  if (!s) {
    return liquid(page("Design not found", `<p>We couldn't find this design. Check the link in your email or order confirmation, or contact us.</p>`), 200);
  }
  const ref = `EMB-${s.number}`;
  const sp = (s.spec ?? {}) as any;
  const links = await fileLinks(admin ?? null, s, true);
  const payment = s.draftOrderId && admin ? await draftOrderStatus(admin, s.draftOrderId).catch(() => null) : null;
  const paid = payment?.status === "COMPLETED";
  const done = new URL(request.url).searchParams.get("done");
  const action = `/apps/embroidery/design/${esc(token)}`;

  const hasProof = !!(s.proofFileId || s.proofData);
  const proofIsImage = /^image\//.test(s.proofType ?? "");
  const showImg = hasProof && proofIsImage && links.proof ? links.proof : links.mockup;

  let status = "";
  if (s.stage === "proof_sent") {
    status = `<div class="status act"><strong>Your proof is ready.</strong> Check the size, placement and colors, then approve it or tell us what to change. We start production after you approve.</div>`;
  } else if (s.stage === "changes_requested") {
    status = `<div class="status"><strong>Thanks, we have your changes.</strong> We'll post an updated proof here.</div>`;
  } else if (s.stage === "approved" || s.stage === "in_production") {
    status = `<div class="status ok"><strong>${s.stage === "approved" ? "Approved" : "In production"}.</strong> ${s.approvedAt ? `You approved this design on ${esc(when(s.approvedAt))}.` : ""} Production takes about 2–3 weeks.</div>`;
  } else if (s.stage === "done") {
    status = `<div class="status ok"><strong>Complete.</strong> Thanks for your order.</div>`;
  } else if (s.stage === "cancelled") {
    status = `<div class="status"><strong>This design was cancelled.</strong> Contact us with any questions.</div>`;
  } else {
    status = `<div class="status"><strong>We're reviewing your design.</strong> We'll post a digital proof here for you to approve, usually within 1–2 business days.</div>`;
  }
  if (done === "approved") status = `<div class="status ok"><strong>Thank you, your design is approved.</strong> We'll start production.</div>`;
  if (done === "changes") status = `<div class="status"><strong>Thanks, we have your changes.</strong> We'll post an updated proof here.</div>`;
  if (done === "message") status += `<div class="status">Your message was sent to our team.</div>`;

  const payBox =
    !paid && s.checkoutUrl && payment && s.stage !== "cancelled"
      ? `<div class="status act"><strong>Your order isn't complete yet.</strong> <a class="btn" style="margin-top:8px" href="${esc(s.checkoutUrl)}">Complete checkout</a></div>`
      : "";

  const colors = (sp.colors ?? [])
    .map((c: any) => `<span class="sw" style="background:${esc(/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#ccc")}"></span>${esc(c.pantone || c.hex)}`)
    .join("&nbsp; ");
  const rows: [string, string][] = [
    ["Apron", `${esc(sp.product?.title ?? s.productTitle ?? "")}${sp.variant?.title ? ` · ${esc(sp.variant.title)}` : ""}`],
    ["Location", esc(sp.zone?.label ?? s.zoneLabel ?? "")],
    ["Logo size", sp.size ? `${esc(sp.size.widthIn)}″ × ${esc(sp.size.heightIn)}″` : ""],
    ["Thread colors", colors],
    ["Quantity", esc(sp.quantity ?? s.quantity)],
    ["Status", esc(stageLabel(s.stage))],
  ];

  const thread = s.messages.length
    ? `<ul class="thread">${s.messages
        .map((m) => `<li class="${m.author === "customer" ? "me" : ""}"><div class="who">${m.author === "customer" ? "You" : esc(m.authorName || "Our team")} · ${esc(when(m.createdAt))}</div><div class="txt">${esc(m.body)}</div></li>`)
        .join("")}</ul>`
    : `<p class="note">No messages yet.</p>`;

  const decide =
    s.stage === "proof_sent"
      ? `<div class="actions">
  <form method="post" action="${action}"><input type="hidden" name="intent" value="approve">
    <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px"><input type="checkbox" name="confirm" value="yes" required> <span>I've checked the spelling, size, placement and colors. Start production.</span></label>
    <button class="btn" type="submit">Approve this proof</button></form>
  <details><summary>Request changes</summary>
    <form method="post" action="${action}"><input type="hidden" name="intent" value="changes">
    <textarea name="body" rows="4" required placeholder="What should we change?"></textarea>
    <button class="btn alt" type="submit">Send changes</button></form></details>
</div>`
      : "";

  const body = `<p class="muted">Design ${esc(ref)}</p>
${status}${payBox}
<div class="grid">
  <figure>${showImg ? `<img src="${esc(showImg)}" alt="Your design">` : `<p class="note">Your preview is still processing. Refresh in a minute.</p>`}
    <figcaption>${hasProof ? "Proof from our team" : "Your preview from the designer"}</figcaption></figure>
  <div>
    <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("")}</table>
    ${decide}
    <h2 style="font-size:20px;margin:28px 0 0">Messages</h2>
    ${thread}
    <form method="post" action="${action}"><input type="hidden" name="intent" value="message">
      <textarea name="body" rows="3" required placeholder="Write to our team"></textarea>
      <button class="btn alt" type="submit">Send message</button></form>
    <p class="note">Keep this link: it's how you'll see proofs and replies for this design.</p>
  </div>
</div>`;
  return liquid(page(`Your embroidery design`, body));
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const token = params.token ?? "";
  const back = (done: string) => new Response(null, { status: 302, headers: { Location: `/apps/embroidery/design/${encodeURIComponent(token)}?done=${done}` } });
  const s = token.length >= 16 && session ? await prisma.submission.findFirst({ where: { token, shop: session.shop } }) : null;
  if (!s) return back("missing");
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const body = String(form.get("body") || "").trim().slice(0, 5000);

  if (intent === "approve" && s.stage === "proof_sent" && form.get("confirm") === "yes") {
    await prisma.submission.update({ where: { id: s.id }, data: { stage: "approved", approvedAt: new Date(), attention: true } });
    await addEvent(s.id, "Customer approved the proof.", "customer");
    return back("approved");
  }
  if (intent === "changes" && body) {
    await prisma.message.create({ data: { submissionId: s.id, kind: "message", author: "customer", body: `Change request: ${body}` } });
    await prisma.submission.update({ where: { id: s.id }, data: { stage: "changes_requested", attention: true } });
    await addEvent(s.id, "Customer asked for changes.", "customer");
    return back("changes");
  }
  if (intent === "message" && body) {
    await prisma.message.create({ data: { submissionId: s.id, kind: "message", author: "customer", body } });
    await prisma.submission.update({ where: { id: s.id }, data: { attention: true } });
    return back("message");
  }
  return back("none");
};
