import prisma from "../db.server";

// Staff notifications: an optional Slack incoming webhook per shop, plus alerts shown in the app.
// Nothing here ever throws: a notification problem must not break a customer's checkout.

export const isSlackWebhook = (u: string) => /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(u);

// Opens the design inside the Shopify admin (the shop's /admin/apps/<api key>/… redirects into the embedded app).
export const adminDesignLink = (shop: string, id: string) =>
  `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY ?? ""}/app/submissions/${id}`;

export async function getSettings(shop: string) {
  return (
    (await prisma.shopSettings.findUnique({ where: { shop } }).catch(() => null)) ?? {
      shop,
      slackWebhook: null as string | null,
      notifyNew: true,
      notifyReply: true,
      updatedAt: new Date(),
    }
  );
}

async function postSlack(webhook: string, text: string) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Slack answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Slack mrkdwn link; escape the characters Slack treats specially.
const slackEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const slackLink = (url: string, label: string) => `<${url}|${slackEsc(label)}>`;

export type NotifyKind = "new" | "reply" | "alert" | "test";

export async function notify(shop: string, kind: NotifyKind, text: string) {
  try {
    const s = await getSettings(shop);
    if (!s.slackWebhook) return false;
    if (kind === "new" && !s.notifyNew) return false;
    if (kind === "reply" && !s.notifyReply) return false;
    await postSlack(s.slackWebhook, text);
    return true;
  } catch (e) {
    console.error(`[notify ${shop}] Slack post failed`, e);
    if (kind === "test") throw e;
    if (kind !== "alert") {
      await prisma.alert
        .create({ data: { shop, kind: "notify_failed", message: "A Slack notification couldn't be sent. Check the webhook in Settings.", detail: String(e).slice(0, 2000) } })
        .catch(() => {});
    }
    return false;
  }
}

// Record a problem for staff (shown in the app) and post it to Slack.
export async function raiseAlert(
  shop: string,
  a: { kind: string; message: string; detail?: unknown; submissionId?: string | null },
) {
  const detail = a.detail == null ? null : (a.detail instanceof Error ? `${a.detail.message}\n${a.detail.stack ?? ""}` : String(a.detail)).slice(0, 4000);
  try {
    await prisma.alert.create({ data: { shop, kind: a.kind, message: a.message.slice(0, 500), detail, submissionId: a.submissionId ?? null } });
  } catch (e) {
    console.error(`[alert ${shop}] couldn't save alert`, a.message, e);
  }
  const link = a.submissionId ? ` ${slackLink(adminDesignLink(shop, a.submissionId), "Open the design")}` : "";
  await notify(shop, "alert", `:warning: *Imprint Customizer problem:* ${slackEsc(a.message)}${link}`);
}
