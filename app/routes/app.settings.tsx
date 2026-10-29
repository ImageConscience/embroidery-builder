import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings, isSlackWebhook, notify } from "../lib/notify.server";

// Settings: Slack notifications for the team, and problems the app ran into.

const KIND: Record<string, string> = {
  checkout_failed: "Checkout failed",
  upload_failed: "File kept in app",
  submit_error: "Submit error",
  notify_failed: "Slack failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const showResolved = new URL(request.url).searchParams.get("resolved") === "1";
  const [s, alerts] = await Promise.all([
    getSettings(session.shop),
    prisma.alert.findMany({
      where: { shop: session.shop, ...(showResolved ? {} : { resolvedAt: null }) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    hasWebhook: !!s.slackWebhook,
    webhookHint: s.slackWebhook ? `…${s.slackWebhook.slice(-6)}` : "",
    notifyNew: s.notifyNew,
    notifyReply: s.notifyReply,
    showResolved,
    alerts: alerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), resolvedAt: a.resolvedAt?.toISOString() ?? null })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = String(f.get("intent") || "");
  const shop = session.shop;

  if (intent === "save") {
    const raw = String(f.get("slackWebhook") || "").trim();
    const clear = f.get("clearWebhook") === "on";
    if (raw && !isSlackWebhook(raw)) return { ok: false, error: "That isn't a Slack incoming webhook URL (it starts with https://hooks.slack.com/services/)." };
    const data: any = { notifyNew: f.get("notifyNew") === "on", notifyReply: f.get("notifyReply") === "on" };
    if (raw) data.slackWebhook = raw;
    if (clear) data.slackWebhook = null;
    await prisma.shopSettings.upsert({ where: { shop }, create: { shop, ...data }, update: data });
    return { ok: true, message: "Settings saved" };
  }
  if (intent === "test") {
    try {
      const sent = await notify(shop, "test", ":wave: Test from Imprint Customizer. New designs, customer replies and problems will show up here.");
      return sent ? { ok: true, message: "Test sent to Slack" } : { ok: false, error: "Add a Slack webhook first." };
    } catch (e) {
      return { ok: false, error: `Slack didn't accept it: ${String((e as Error).message ?? e).slice(0, 200)}` };
    }
  }
  if (intent === "resolve") {
    const id = String(f.get("id") || "");
    await prisma.alert.updateMany({ where: { id, shop }, data: { resolvedAt: new Date() } });
    return { ok: true, message: "Marked resolved" };
  }
  if (intent === "resolveAll") {
    await prisma.alert.updateMany({ where: { shop, resolvedAt: null }, data: { resolvedAt: new Date() } });
    return { ok: true, message: "All marked resolved" };
  }
  return { ok: false, error: "Unknown action" };
};

export default function Settings() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const busy = nav.state !== "idle";
  useEffect(() => {
    if (!result) return;
    if (result.ok) shopify.toast.show((result as any).message);
    else shopify.toast.show((result as any).error, { isError: true });
  }, [result]);

  return (
    <s-page heading="Settings">
      <div className="st-card">
        <h2>Team notifications (Slack)</h2>
        <p className="st-muted">
          Post to a Slack channel when a design comes in, when a customer replies, approves or asks for changes, and when
          something goes wrong. In Slack: <em>Apps → Incoming Webhooks → Add to Slack</em>, pick the channel, then paste the
          webhook URL here. Leave it empty to use the app only (the design center always shows what needs a reply).
        </p>
        <Form method="post" className="st-form">
          <input type="hidden" name="intent" value="save" />
          <label className="st-f">
            <span>Slack webhook URL {d.hasWebhook ? <small>(saved, ends {d.webhookHint})</small> : null}</span>
            <input name="slackWebhook" type="url" placeholder={d.hasWebhook ? "Paste a new URL to replace it" : "https://hooks.slack.com/services/…"} autoComplete="off" />
          </label>
          {d.hasWebhook ? (
            <label className="st-check"><input type="checkbox" name="clearWebhook" /> Remove the saved webhook</label>
          ) : null}
          <label className="st-check"><input type="checkbox" name="notifyNew" defaultChecked={d.notifyNew} /> New designs</label>
          <label className="st-check"><input type="checkbox" name="notifyReply" defaultChecked={d.notifyReply} /> Customer messages, approvals and change requests</label>
          <p className="st-muted">Problems are always posted.</p>
          <div className="st-actions">
            <button className="st-btn" type="submit" disabled={busy}>Save</button>
          </div>
        </Form>
        {d.hasWebhook ? (
          <Form method="post">
            <input type="hidden" name="intent" value="test" />
            <button className="st-btn alt" type="submit" disabled={busy}>Send a test message</button>
          </Form>
        ) : null}
      </div>

      <div className="st-card" id="problems">
        <div className="st-head">
          <h2>Problems {d.alerts.filter((a) => !a.resolvedAt).length ? `(${d.alerts.filter((a) => !a.resolvedAt).length} open)` : ""}</h2>
          <span>
            <Link to={d.showResolved ? "?" : "?resolved=1"}>{d.showResolved ? "Hide resolved" : "Show resolved"}</Link>
            {d.alerts.some((a) => !a.resolvedAt) ? (
              <Form method="post" style={{ display: "inline", marginLeft: 12 }}>
                <input type="hidden" name="intent" value="resolveAll" />
                <button className="st-link" type="submit" disabled={busy}>Mark all resolved</button>
              </Form>
            ) : null}
          </span>
        </div>
        {d.alerts.length === 0 ? (
          <p className="st-muted">No problems. If checkout can't be created, a file can't be saved or a Slack message fails, it shows up here.</p>
        ) : (
          <ul className="st-alerts">
            {d.alerts.map((a) => (
              <li key={a.id} className={a.resolvedAt ? "is-done" : ""}>
                <div className="st-top">
                  <span className="st-kind">{KIND[a.kind] ?? a.kind}</span>
                  <span className="st-muted">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
                <div>{a.message}</div>
                <div className="st-row">
                  {a.submissionId ? <Link to={`/app/submissions/${a.submissionId}`}>Open the design</Link> : null}
                  {a.detail ? (
                    <details><summary>Technical details</summary><pre>{a.detail}</pre></details>
                  ) : null}
                  {!a.resolvedAt ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="resolve" />
                      <input type="hidden" name="id" value={a.id} />
                      <button className="st-link" type="submit" disabled={busy}>Mark resolved</button>
                    </Form>
                  ) : <span className="st-muted">Resolved</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <style>{`
        .st-card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06);font-size:14px}
        .st-card h2{font-size:16px;margin:0 0 8px}
        .st-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
        .st-muted{color:#616161;font-size:13px}
        .st-form{display:flex;flex-direction:column;gap:10px;margin:12px 0}
        .st-f{display:flex;flex-direction:column;gap:4px;font-size:13px}
        .st-f span{font-weight:500}
        .st-f input{font:inherit;font-size:14px;padding:6px 10px;border:1px solid #8a8a8a;border-radius:8px;max-width:560px}
        .st-check{display:flex;gap:6px;align-items:center;font-size:13px}
        .st-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:0;background:#303030;color:#fff;cursor:pointer}
        .st-btn.alt{background:#fff;color:#303030;box-shadow:0 0 0 1px #8a8a8a}
        .st-btn:disabled{opacity:.5}
        .st-link{font:inherit;font-size:13px;border:0;background:none;color:#005bd3;cursor:pointer;padding:0}
        .st-alerts{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column;gap:10px}
        .st-alerts li{border:1px solid #e3e3e3;border-left:4px solid #e51c00;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
        .st-alerts li.is-done{border-left-color:#c9c9c9;opacity:.75}
        .st-top{display:flex;justify-content:space-between;gap:8px}
        .st-kind{font-size:12px;font-weight:600;background:#fee9e8;color:#8e1f0b;border-radius:6px;padding:1px 8px}
        .st-row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;font-size:13px}
        .st-row pre{white-space:pre-wrap;font-size:12px;max-height:200px;overflow:auto;background:#f6f6f6;padding:8px;border-radius:6px}
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
