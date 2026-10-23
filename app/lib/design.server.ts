import crypto from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import prisma from "../db.server";
import { fileUrls, type AdminLike } from "./files.server";
import { firstDecoration } from "./spec";

// Design center helpers: workflow stages, customer links, signed file URLs and the production package.

export { STAGES, stageLabel, isStage, type StageId } from "./stages";

export const newToken = () => crypto.randomBytes(18).toString("base64url");

export async function ensureToken(id: string, token: string | null) {
  if (token) return token;
  const t = newToken();
  await prisma.submission.update({ where: { id }, data: { token: t } });
  return t;
}

// The customer's design page, through the shop's app proxy (renders inside the store theme).
export const customerLink = (shop: string, token: string) => `https://${shop}/apps/imprint/design/${token}`;

/* ---------- signed URLs for files served by the app (no admin session in <img> or downloads) ---------- */

const secret = () => process.env.SHOPIFY_API_SECRET || "dev-secret";
const appUrl = () => (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

export type FileKind = "logo" | "mockup" | "proof" | "artwork" | "package";

function sign(id: string, kind: string, exp: number) {
  return crypto.createHmac("sha256", secret()).update(`${id}:${kind}:${exp}`).digest("base64url").slice(0, 32);
}
export function signedUrl(id: string, kind: FileKind, ttlSeconds = 3600 * 24, absolute = false) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const path = `/files/${id}/${kind}?exp=${exp}&sig=${sign(id, kind, exp)}`;
  return absolute ? `${appUrl()}${path}` : path;
}
export function checkSignature(id: string, kind: string, exp: string | null, sig: string | null) {
  const e = Number(exp);
  if (!e || e < Date.now() / 1000 || !sig) return false;
  const want = sign(id, kind, e);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

type SubFiles = {
  id: string;
  logoFileId: string | null;
  logoData: Uint8Array | null;
  logoType: string;
  logoName: string;
  mockupFileId: string | null;
  mockupData: Uint8Array | null;
  proofFileId: string | null;
  proofData: Uint8Array | null;
  proofType: string | null;
  proofName: string | null;
  artworkFileId: string | null;
  artworkData: Uint8Array | null;
};

// Where each file can be viewed: the Shopify Files CDN URL when available, else a signed app URL.
export async function fileLinks(admin: AdminLike | null, s: SubFiles, absolute = false) {
  const ids = [s.logoFileId, s.mockupFileId, s.proofFileId, s.artworkFileId].filter(Boolean) as string[];
  const cdn = admin && ids.length ? await fileUrls(admin, ids).catch(() => ({}) as Record<string, string | null>) : {};
  const pick = (fileId: string | null, data: Uint8Array | null, kind: FileKind) =>
    (fileId && cdn[fileId]) || (data ? signedUrl(s.id, kind, 3600 * 24, absolute) : null);
  return {
    logo: pick(s.logoFileId, s.logoData, "logo"),
    mockup: pick(s.mockupFileId, s.mockupData, "mockup"),
    proof: pick(s.proofFileId, s.proofData, "proof"),
    artwork: pick(s.artworkFileId, s.artworkData, "artwork"),
    pending: {
      logo: !!s.logoFileId && !cdn[s.logoFileId],
      mockup: !!s.mockupFileId && !cdn[s.mockupFileId],
      proof: !!s.proofFileId && !cdn[s.proofFileId],
    },
  };
}

// File bytes, from the database copy or downloaded from Shopify Files.
export async function fileBytes(admin: AdminLike | null, fileId: string | null, data: Uint8Array | null) {
  if (data) return new Uint8Array(data);
  if (!fileId || !admin) return null;
  const url = (await fileUrls(admin, [fileId]).catch(() => ({}) as Record<string, string | null>))[fileId];
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

const extFor = (type: string | null | undefined, name?: string | null) => {
  const fromName = name?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "application/pdf": "pdf", "image/webp": "webp" } as Record<string, string>)[type ?? ""] ?? "bin";
};
const safe = (s: string) => s.replace(/[^\w.\- ]+/g, "_").slice(0, 80);
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// One-page spec sheet (HTML, prints well) for the embroiderer/digitizer.
export function specSheetHtml(ref: string, s: any, files: { mockup?: string; artwork?: string; proof?: string }) {
  const sp = s.spec ?? {};
  const d = firstDecoration(sp);
  const emb = (d?.method.kind ?? "embroidery") === "embroidery";
  const rows: [string, string][] = [
    ["Reference", ref],
    ["Apron", `${sp.product?.title ?? s.productTitle ?? "—"}${sp.variant?.title ? ` · ${sp.variant.title}` : ""}`],
    ["Method", d?.method.name ?? "—"],
    ["Location", d?.zone?.label ?? "—"],
    ["Logo size", d?.size ? `${d.size.widthIn}" wide × ${d.size.heightIn}" tall` : "—"],
    ["Position", d?.position ? `Logo center ${d.position.centerXIn}" from the left and ${d.position.centerYIn}" from the top of the ${d.position.zoneWidthIn}" × ${d.position.zoneHeightIn}" location` : "—"],
    ["Background", d?.background === "kept" ? `Kept: ${emb ? "stitch" : "print"} the logo's background as a solid fill` : d?.background === "removed" ? `Removed${d?.insideAreasStitched ? " (areas inside the logo are filled)" : ""}` : "None"],
    ...(emb
      ? ([["Est. stitches", d?.estimate ? `≈ ${Number(d.estimate.stitches).toLocaleString()} (fill ${d.estimate.fillSqIn} sq in, satin ${d.estimate.satinSqIn} sq in, outline ${d.estimate.outlineIn} in)` : "—"]] as [string, string][])
      : []),
    ["Quantity", String(sp.quantity ?? s.quantity ?? "—")],
  ];
  const colors = (d?.colors ?? [])
    .map((c: any, i: number) => `<tr><td>${i + 1}</td><td><span class="sw" style="background:${esc(c.hex)}"></span>${esc(c.hex)}</td><td>${esc(c.pantone || "—")}</td><td>${Math.round((c.share ?? 0) * 100)}%</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ref)} spec sheet</title>
<style>body{font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#222;margin:32px;max-width:900px}h1{font-size:22px;margin:0 0 4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}.grid img{max-width:100%;border:1px solid #ddd}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #e5e5e5;padding:6px 8px;vertical-align:top}td:first-child{color:#666;width:150px}
.sw{display:inline-block;width:14px;height:14px;border:1px solid #999;border-radius:3px;margin-right:6px;vertical-align:-2px}
@media print{body{margin:12mm}}</style></head><body>
<h1>${esc(ref)} · ${esc(d?.method.name ?? "Embroidery")} spec</h1><div>Generated ${new Date().toLocaleString("en-US")}</div>
<div class="grid">${files.mockup ? `<div><strong>Mockup</strong><br><img src="${esc(files.mockup)}" alt=""></div>` : ""}${files.artwork ? `<div><strong>Artwork (as approved colors)</strong><br><img src="${esc(files.artwork)}" alt=""></div>` : ""}${files.proof ? `<div><strong>Proof</strong><br><img src="${esc(files.proof)}" alt=""></div>` : ""}</div>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<h2 style="font-size:16px;margin-top:24px">${emb ? "Thread" : "Ink"} colors</h2>
<table><tr><td>#</td><td>Hex</td><td>Pantone</td><td>Share of logo</td></tr>${colors}</table>
${s.notes ? `<h2 style="font-size:16px;margin-top:24px">Customer notes</h2><p>${esc(s.notes)}</p>` : ""}
<p style="color:#666;margin-top:24px">${emb ? "Stitch count is the builder's estimate. Thread is matched to the hex or Pantone at digitizing." : "Inks are matched to the closest stock color unless a Pantone code is given."}</p>
</body></html>`;
}

// Zip with everything the embroiderer needs: original logo, artwork, mockup, proof and the spec sheet.
export async function buildPackage(admin: AdminLike | null, s: any) {
  const ref = `EMB-${s.number}`;
  const files: Record<string, Uint8Array> = {};
  const add = async (name: string, fileId: string | null, data: Uint8Array | null) => {
    const b = await fileBytes(admin, fileId, data).catch(() => null);
    if (b) files[name] = b;
    return b ? name : undefined;
  };
  await add(`original-logo-${safe(s.logoName)}`, s.logoFileId, s.logoData);
  const artwork = await add("artwork.png", s.artworkFileId, s.artworkData);
  const mockup = await add("mockup.png", s.mockupFileId, s.mockupData);
  const proof = await add(`proof.${extFor(s.proofType, s.proofName)}`, s.proofFileId, s.proofData);
  files["spec-sheet.html"] = strToU8(specSheetHtml(ref, s, { mockup, artwork, proof: proof && /png|jpe?g|webp|gif|svg/.test(proof) ? proof : undefined }));
  files["spec.json"] = strToU8(JSON.stringify({ reference: ref, ...(s.spec ?? {}), notes: s.notes ?? null }, null, 2));
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [`${ref}/${k}`, v])), { level: 6 });
  return { name: `${ref}.zip`, bytes: zipped };
}

export async function addEvent(submissionId: string, body: string, author = "system", authorName?: string) {
  await prisma.message.create({ data: { submissionId, kind: "event", author, authorName, body } });
}
