// Volume discounts on the aprons (not the decoration), kept as a sheet staff can download and
// upload. Mirrors the store's volume-discount app, whose tiers can't be read through an API.
// Rows: match_type (collection | vendor | all), match (collection handle or vendor name),
// min_qty, percent_off. Rows sharing a match form one tier list; the first list (in sheet order)
// that matches the product wins, so put specific collections above their vendor.

import { parseCsv } from "./threads";

export type VolumeRow = { type: "collection" | "vendor" | "all"; match: string; minQty: number; percent: number; label: string };
export type VolumeGroup = { type: VolumeRow["type"]; match: string; label: string; tiers: { min: number; percent: number }[] };

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function volumeToCsv(rows: VolumeRow[]) {
  return ["match_type,match,min_qty,percent_off,label", ...rows.map((r) => [r.type, r.match, String(r.minQty), String(r.percent), r.label].map(csvCell).join(","))].join("\n") + "\n";
}

export function volumeFromCsv(text: string): { rows: VolumeRow[]; errors: string[] } {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], errors: ["The file is empty."] };
  const head = all[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]+/g, "_"));
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iT = col("match_type", "type", "applies_to"), iM = col("match", "value", "collection", "vendor", "handle");
  const iQ = col("min_qty", "min", "minimum", "quantity", "qty", "min_quantity"), iP = col("percent_off", "percent", "discount", "pct", "off");
  const iL = col("label", "name", "note");
  const errors: string[] = [];
  if (iQ < 0) errors.push("Couldn't find a min_qty column.");
  if (iP < 0) errors.push("Couldn't find a percent_off column.");
  if (errors.length) return { rows: [], errors };
  const rows: VolumeRow[] = [];
  for (let r = 1; r < all.length; r++) {
    const c = all[r];
    const t = String(c[iT] ?? "all").trim().toLowerCase();
    const type = (t === "collection" || t === "vendor" ? t : "all") as VolumeRow["type"];
    const match = iM >= 0 ? String(c[iM] ?? "").trim() : "";
    const minQty = parseInt(String(c[iQ] ?? "").replace(/[^\d]/g, ""), 10);
    const percent = parseFloat(String(c[iP] ?? "").replace(/[^\d.]/g, ""));
    if (!minQty || !(percent > 0) || percent >= 100) continue;
    if (type !== "all" && !match) { errors.push(`Row ${r + 1}: ${type} rows need a match value.`); continue; }
    rows.push({ type, match, minQty, percent, label: iL >= 0 ? String(c[iL] ?? "").trim().slice(0, 80) : "" });
  }
  if (!rows.length && !errors.length) errors.push("No rows with a minimum quantity and a percent off were found.");
  return { rows, errors };
}

export function groupVolume(rows: VolumeRow[]): VolumeGroup[] {
  const out: VolumeGroup[] = [];
  for (const r of rows) {
    const key = r.type === "all" ? "all" : r.match.toLowerCase();
    let g = out.find((x) => x.type === r.type && (x.type === "all" ? "all" : x.match.toLowerCase()) === key);
    if (!g) out.push((g = { type: r.type, match: r.match, label: r.label, tiers: [] }));
    if (!g.label && r.label) g.label = r.label;
    g.tiers.push({ min: r.minQty, percent: r.percent });
  }
  out.forEach((g) => g.tiers.sort((a, b) => a.min - b.min));
  return out;
}

export function volumeGroupFor(groups: VolumeGroup[], product: { vendor?: string | null; collections?: string[] }) {
  const vendor = String(product.vendor ?? "").trim().toLowerCase();
  const cols = (product.collections ?? []).map((h) => h.toLowerCase());
  return (
    groups.find((g) => (g.type === "collection" && cols.includes(g.match.toLowerCase())) || (g.type === "vendor" && vendor && vendor === g.match.toLowerCase()) || g.type === "all") ?? null
  );
}

export function volumePercent(group: VolumeGroup | null, qty: number) {
  let pct = 0, min = 0;
  for (const t of group?.tiers ?? []) if (qty >= t.min) { pct = t.percent; min = t.min; }
  return { percent: pct, min };
}

// ApronWarehouse's tiers as shown on its product pages (Nov 2026). Chef Designs, Uncommon Threads,
// Jessie Steele and Port Authority showed no tier table and are left out.
const SIX = [[6, 2], [12, 3], [24, 6], [48, 9], [72, 12], [144, 15], [300, 20]];
const THREE = [[3, 2], [6, 4], [12, 6], [24, 8], [48, 10]];
const DAYSTAR = [[12, 3], [24, 5], [48, 7], [72, 8], [144, 10], [1500, 15], [2000, 20]];
const MASKS = [[3, 3], [6, 6], [12, 12], [24, 15], [36, 20], [72, 30], [100, 35]];
const SEED: [string, string, number[][]][] = [
  ["daystar-denim-canvas-aprons", "DayStar Denim & Canvas", THREE],
  ["daystar-aprons", "DayStar", DAYSTAR],
  ["edwards-aprons", "Edwards", SIX],
  ["fame-aprons", "Fame", SIX],
  ["pinnacle-textile-aprons", "Pinnacle", SIX],
  ["ut-black-collection-aprons", "UT Black Collection", SIX],
  ["aw-essentials-aprons", "AW Essentials", SIX],
  ["artisan-collection-by-reprime", "Artisan Collection by Reprime", THREE],
  ["chef-works-aprons", "Chef Works", THREE],
  ["now-designs-aprons", "Now Designs", THREE],
  ["bragard-aprons", "Bragard", THREE],
  ["adult-face-masks", "Adult face masks", MASKS],
  ["kids-face-masks", "Kids face masks", MASKS],
];
export const SEED_VOLUME: VolumeRow[] = SEED.flatMap(([handle, label, tiers]) =>
  tiers.map(([minQty, percent]) => ({ type: "collection" as const, match: handle, minQty, percent, label })),
);
