import prisma from "../db.server";
import { DEFAULT_METHODS, type MethodData, type MethodKind, type Tier } from "./methods";

// Methods are stored per shop in the app database (pricing must be trusted on the server).

const toData = (m: any): MethodData => ({
  key: m.key,
  name: m.name,
  kind: m.kind as MethodKind,
  description: m.description,
  enabled: m.enabled,
  position: m.position,
  minimum: m.minimum,
  minimumRule: m.minimumRule === "per_variant" ? "per_variant" : "total",
  tiers: (m.tiers as Tier[]) ?? [],
  setupFee: m.setupFee,
  includedStitches: m.includedStitches,
  perThousandStitches: m.perThousandStitches,
  includedColors: m.includedColors,
  perExtraColor: m.perExtraColor,
  customColorFee: m.customColorFee,
  maxColors: m.maxColors,
  leadTime: m.leadTime,
  colorNote: m.colorNote,
});

// Create ApronWarehouse's default methods the first time a shop uses the app.
export async function ensureMethods(shop: string) {
  const count = await prisma.method.count({ where: { shop } });
  if (count) return;
  for (const m of DEFAULT_METHODS) {
    await prisma.method
      .create({ data: { shop, ...m, tiers: m.tiers as any } })
      .catch(() => {}); // another request may have created it
  }
}

export async function listMethods(shop: string, opts: { enabledOnly?: boolean } = {}) {
  await ensureMethods(shop);
  const rows = await prisma.method.findMany({
    where: { shop, ...(opts.enabledOnly ? { enabled: true } : {}) },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  return rows.map(toData);
}

export async function getMethod(shop: string, key: string) {
  await ensureMethods(shop);
  const m = await prisma.method.findUnique({ where: { shop_key: { shop, key } } });
  return m ? toData(m) : null;
}

export async function saveMethod(shop: string, data: MethodData) {
  const { key, ...rest } = data;
  await prisma.method.upsert({
    where: { shop_key: { shop, key } },
    create: { shop, key, ...rest, tiers: rest.tiers as any },
    update: { ...rest, tiers: rest.tiers as any },
  });
}
