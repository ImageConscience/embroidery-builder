import prisma from "../db.server";
import SEASIDE_ISACORD from "../data/seaside-isacord.csv?raw";
import { matchThread, rowsFromCsv, type ThreadMatch, type ThreadRow } from "./threads";

export type ChartSummary = { id: string; name: string; brand: string; fileName: string; rowCount: number; updatedAt: string };

const summary = (c: any): ChartSummary => ({
  id: c.id, name: c.name, brand: c.brand, fileName: c.fileName, rowCount: c.rowCount, updatedAt: c.updatedAt.toISOString(),
});

// The first time a shop opens thread charts, add Seaside's Pantone → Isacord chart (from Lindsey,
// Nov 2026) and attach it to methods named Seaside that have no chart yet.
export async function ensureCharts(shop: string) {
  const n = await prisma.threadChart.count({ where: { shop } });
  if (n) return;
  const { rows } = rowsFromCsv(SEASIDE_ISACORD);
  const c = await prisma.threadChart.create({
    data: { shop, name: "Seaside: Pantone to Isacord", brand: "Isacord", fileName: "Pantone to Isacord (Seaside).csv", rows: rows as any, rowCount: rows.length },
  });
  await prisma.method.updateMany({ where: { shop, threadChartId: null, name: { contains: "Seaside", mode: "insensitive" } }, data: { threadChartId: c.id } });
}

export async function listCharts(shop: string) {
  await ensureCharts(shop);
  const rows = await prisma.threadChart.findMany({ where: { shop }, orderBy: { name: "asc" } });
  return rows.map(summary);
}

export async function chartRows(shop: string, id: string | null | undefined): Promise<ThreadRow[]> {
  if (!id) return [];
  const c = await prisma.threadChart.findFirst({ where: { id, shop } });
  return c ? ((c.rows as ThreadRow[]) ?? []) : [];
}

export async function getChart(shop: string, id: string) {
  const c = await prisma.threadChart.findFirst({ where: { id, shop } });
  return c ? { ...summary(c), rows: (c.rows as ThreadRow[]) ?? [] } : null;
}

export async function saveChart(shop: string, input: { id?: string; name: string; brand: string; fileName: string; rows: ThreadRow[] }) {
  const data = { name: input.name, brand: input.brand, fileName: input.fileName, rows: input.rows as any, rowCount: input.rows.length };
  if (input.id) {
    const found = await prisma.threadChart.findFirst({ where: { id: input.id, shop } });
    if (!found) throw new Error("Chart not found");
    return summary(await prisma.threadChart.update({ where: { id: input.id }, data }));
  }
  return summary(await prisma.threadChart.create({ data: { shop, ...data } }));
}

export async function renameChart(shop: string, id: string, name: string, brand: string) {
  await prisma.threadChart.updateMany({ where: { id, shop }, data: { name, brand } });
}

export async function deleteChart(shop: string, id: string) {
  await prisma.method.updateMany({ where: { shop, threadChartId: id }, data: { threadChartId: null } });
  await prisma.threadChart.deleteMany({ where: { id, shop } });
}

// Suggested thread for each of a design's colors, using the method's chart.
export async function threadsForColors(shop: string, chartId: string | null | undefined, colors: { hex?: string; pantone?: string }[]) {
  const rows = await chartRows(shop, chartId);
  const chart = chartId ? await prisma.threadChart.findFirst({ where: { id: chartId, shop }, select: { name: true, brand: true } }) : null;
  return {
    chart: chart ? { name: chart.name, brand: chart.brand } : null,
    matches: colors.map((c) => (rows.length ? matchThread(rows, c) : null)) as (ThreadMatch | null)[],
  };
}
