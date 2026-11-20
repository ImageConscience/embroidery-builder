import nodemailer from "nodemailer";

// Outgoing email (staff notifications). Configure one of these on the server (Railway variables):
//   RESEND_API_KEY  an API key from resend.com (sending domain verified there), or
//   SMTP_URL        smtp(s)://user:password@host:port, e.g. a Google Workspace or Microsoft 365 mailbox
// plus EMAIL_FROM, the sender, e.g. "ApronWarehouse Designs <designs@apronwarehouse.com>".

export type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string };

export const emailConfigured = () => !!(process.env.RESEND_API_KEY || process.env.SMTP_URL) && !!process.env.EMAIL_FROM;
export const emailProvider = () => (process.env.RESEND_API_KEY ? "Resend" : process.env.SMTP_URL ? "SMTP" : null);
export const isEmail = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

let transport: nodemailer.Transporter | null = null;

export async function sendEmail(m: Mail) {
  if (!emailConfigured()) throw new Error("Email isn't set up on the server (RESEND_API_KEY or SMTP_URL, and EMAIL_FROM).");
  if (!isEmail(m.to)) throw new Error(`Not an email address: ${m.to}`);
  const from = process.env.EMAIL_FROM!;
  const replyTo = m.replyTo && isEmail(m.replyTo) ? m.replyTo : undefined;
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo });
}

export const escHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
