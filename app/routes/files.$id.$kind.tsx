import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { buildPackage, checkSignature, fileLinks } from "../lib/design.server";

// Signed file links for the admin design page, the customer design page and downloads.
// GET /files/:id/:kind?exp=...&sig=...   kind: logo | mockup | proof | artwork | package
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const id = params.id ?? "";
  const kind = params.kind ?? "";
  if (!checkSignature(id, kind, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("This link has expired. Reload the page to get a new one.", { status: 403 });
  }
  const s = await prisma.submission.findUnique({ where: { id } });
  if (!s) return new Response("Not found", { status: 404 });

  const admin = await unauthenticated
    .admin(s.shop)
    .then((r) => r.admin)
    .catch(() => null);

  if (kind === "package") {
    const pkg = await buildPackage(admin, s);
    return new Response(pkg.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${pkg.name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const db: Record<string, { data: Uint8Array | null; type: string; name: string }> = {
    logo: { data: s.logoData, type: s.logoType, name: s.logoName },
    mockup: { data: s.mockupData, type: "image/png", name: `EMB-${s.number}-mockup.png` },
    proof: { data: s.proofData, type: s.proofType ?? "application/octet-stream", name: s.proofName ?? "proof" },
    artwork: { data: s.artworkData, type: "image/png", name: `EMB-${s.number}-artwork.png` },
  };
  const f = db[kind];
  if (!f) return new Response("Not found", { status: 404 });
  if (f.data) {
    const download = url.searchParams.get("download") === "1";
    return new Response(new Uint8Array(f.data) as unknown as BodyInit, {
      headers: {
        "Content-Type": f.type,
        "Cache-Control": "private, max-age=3600",
        ...(download ? { "Content-Disposition": `attachment; filename="${f.name.replace(/"/g, "")}"` } : {}),
      },
    });
  }
  // Stored in Shopify Files: send the browser there.
  const links = await fileLinks(admin, s);
  const target = (links as any)[kind] as string | null;
  if (target && /^https:/.test(target)) return Response.redirect(target, 302);
  return new Response("File not available yet", { status: 404 });
};
