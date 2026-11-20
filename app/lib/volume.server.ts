import prisma from "../db.server";
import type { AdminLike } from "./files.server";
import { groupVolume, SEED_VOLUME, volumeGroupFor, volumePercent, type VolumeRow } from "./volume";

const SEED_SHOPS = /apronwarehouse/i; // only ApronWarehouse starts with its known tiers

export async function getVolume(shop: string) {
  let v = await prisma.volumeDiscounts.findUnique({ where: { shop } });
  if (!v && SEED_SHOPS.test(shop)) {
    v = await prisma.volumeDiscounts.create({ data: { shop, rows: SEED_VOLUME as any, fileName: "Read from the product pages, Nov 2026" } });
  }
  return { rows: ((v?.rows as VolumeRow[]) ?? []), fileName: v?.fileName ?? "", updatedAt: v?.updatedAt?.toISOString() ?? null };
}

export async function saveVolume(shop: string, rows: VolumeRow[], fileName: string) {
  await prisma.volumeDiscounts.upsert({ where: { shop }, create: { shop, rows: rows as any, fileName }, update: { rows: rows as any, fileName } });
}

// The discount for this product and quantity, checked on the server at checkout.
export async function volumeDiscountFor(admin: AdminLike, shop: string, productId: string | number | null | undefined, qty: number) {
  const { rows } = await getVolume(shop);
  if (!rows.length || !productId) return { percent: 0, min: 0, label: "" };
  const gid = String(productId).startsWith("gid://") ? String(productId) : `gid://shopify/Product/${productId}`;
  const res = await admin.graphql(`#graphql
    query productForVolume($id: ID!) { product(id: $id) { vendor collections(first: 100) { nodes { handle } } } }`, { variables: { id: gid } });
  const p = ((await res.json()) as any)?.data?.product;
  if (!p) return { percent: 0, min: 0, label: "" };
  const group = volumeGroupFor(groupVolume(rows), { vendor: p.vendor, collections: (p.collections?.nodes ?? []).map((n: any) => n.handle) });
  const v = volumePercent(group, qty);
  return { ...v, label: group?.label ?? "" };
}
