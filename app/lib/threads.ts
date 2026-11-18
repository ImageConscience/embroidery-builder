// Thread charts: each vendor's Pantone (PMS) → thread number cross-reference, uploaded as CSV.
// Used to turn a customer's hex or PMS color into the vendor's thread number for production.

import PANTONE_HEX from "../data/pantone-c.json";

export type ThreadRow = { pms: string; hex: string; thread: string; threadName: string };

const PMS_HEX = PANTONE_HEX as Record<string, string>;

// "185C", "PMS 185 c", "Pantone 185" → "185 C". "Cool Gray 5C" → "COOL GRAY 5 C".
export function normalizePms(input: string): string {
  let s = String(input ?? "").toUpperCase().replace(/PANTONE|PMS/g, " ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/(\d)(C|U|CP|UP|TCX|TPX)$/, "$1").replace(/ (C|U|CP|UP|TCX|TPX)$/, "").trim();
  return s ? s + " C" : "";
}

export function normalizeHex(input: string): string {
  let s = String(input ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(s) ? "#" + s.toUpperCase() : "";
}

export const pantoneHex = (pms: string) => PMS_HEX[normalizePms(pms)] ?? "";

/* ---------- CSV ---------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = String(text ?? "").replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: ThreadRow[]): string {
  return ["pms,hex,thread,thread_name", ...rows.map((r) => [r.pms, r.hex, r.thread, r.threadName].map(csvCell).join(","))].join("\n") + "\n";
}

// Reads a chart CSV. Columns are found by their header: PMS/Pantone, hex, thread (or the thread
// brand's name, e.g. Isacord or Gunold), and an optional thread name. Hex can be left out; it is
// filled from the Pantone code so hex-only customer colors still find a match.
export function rowsFromCsv(text: string): { rows: ThreadRow[]; errors: string[]; filledHex: number } {
  const all = parseCsv(text);
  const errors: string[] = [];
  if (!all.length) return { rows: [], errors: ["The file is empty."], filledHex: 0 };
  const head = all[0].map((h) => h.trim().toLowerCase());
  const find = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)));
  let iP = find(/^pms/, /pantone/, /^pms ?(code|color)/);
  let iH = find(/^hex/, /^#$/, /rgb/);
  let iN = find(/thread[ _]?name/, /^name$/, /color ?name/, /description/);
  let iT = head.findIndex((h, i) => i !== iP && i !== iH && i !== iN && /thread|isacord|gunold|madeira|robison|sulky|number|^no\.?$|^#?code/.test(h));
  let start = 1;
  if (iP < 0 && iT < 0 && /\d/.test(all[0][0] ?? "") && /^\s*\d{3,}/.test(all[0][1] ?? "")) {
    // No header row: assume pms, thread[, hex]
    iP = 0; iT = 1; iH = all[0].length > 2 ? 2 : -1; iN = -1; start = 0;
  }
  if (iP < 0) errors.push("Couldn't find a Pantone / PMS column. Name a column PMS.");
  if (iT < 0) errors.push("Couldn't find a thread number column. Name a column Thread.");
  if (errors.length) return { rows: [], errors, filledHex: 0 };
  const rows: ThreadRow[] = [];
  let filledHex = 0;
  for (let r = start; r < all.length; r++) {
    const c = all[r];
    const pms = normalizePms(c[iP] ?? "");
    const thread = String(c[iT] ?? "").trim();
    if (!pms || !thread) continue;
    let hex = iH >= 0 ? normalizeHex(c[iH] ?? "") : "";
    if (!hex) { hex = pantoneHex(pms); if (hex) filledHex++; }
    rows.push({ pms, hex, thread, threadName: iN >= 0 ? String(c[iN] ?? "").trim() : "" });
  }
  if (!rows.length) errors.push("No rows with both a Pantone code and a thread number were found.");
  return { rows, errors, filledHex };
}

/* ---------- matching ---------- */

function lab(hex: string): [number, number, number] | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  const X = (v[0] * 0.4124 + v[1] * 0.3576 + v[2] * 0.1805) / 0.95047;
  const Y = v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  const Z = (v[0] * 0.0193 + v[1] * 0.1192 + v[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export type ThreadMatch = {
  pms: string; // the Pantone the thread was chosen from
  thread: string; // first (preferred) thread number
  threadName: string;
  alternates: string[]; // other thread numbers listed for the same Pantone
  via: "pms" | "hex"; // matched on the customer's PMS code, or nearest color to their hex
  distance: number | null; // color difference (ΔE) for hex matches; under ~5 is close, over ~15 is a stretch
};

// Customer gave a PMS code → look it up directly (falling back to its hex if the chart lacks it).
// Otherwise the chart row whose color is nearest the hex.
export function matchThread(rows: ThreadRow[], color: { hex?: string; pantone?: string }): ThreadMatch | null {
  if (!rows.length) return null;
  const byPms = (pms: string) => rows.filter((r) => r.pms === pms);
  const result = (list: ThreadRow[], via: "pms" | "hex", distance: number | null): ThreadMatch => ({
    pms: list[0].pms,
    thread: list[0].thread,
    threadName: list[0].threadName,
    alternates: list.slice(1).map((r) => r.thread),
    via,
    distance: distance == null ? null : Math.round(distance * 10) / 10,
  });
  let hex = normalizeHex(color.hex ?? "");
  if (color.pantone) {
    const pms = normalizePms(color.pantone);
    const hit = byPms(pms);
    if (hit.length) return result(hit, "pms", null);
    hex = pantoneHex(pms) || hex;
  }
  const target = lab(hex);
  if (!target) return null;
  let best: ThreadRow | null = null, bestD = Infinity;
  for (const r of rows) {
    const l = lab(r.hex);
    if (!l) continue;
    const d = dE(target, l);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? result(byPms(best.pms), "hex", bestD) : null;
}

// Plain words for a hex match's color difference.
export function closeness(d: number | null) {
  if (d == null) return "";
  if (d < 3) return "Very close";
  if (d < 8) return "Close";
  if (d < 15) return "Nearest in chart, check it";
  return "Not close, pick by hand";
}
