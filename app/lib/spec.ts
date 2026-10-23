// Reading a design's spec. Version 2 (Oct 2026) has a list of decorations, each with its method;
// earlier designs were embroidery-only with the fields at the top level.

export type Decoration = {
  method: { key: string; name: string; kind: string };
  zone: { id?: string; label?: string } | null;
  size: { widthIn: number; heightIn: number } | null;
  position: { centerXIn: number; centerYIn: number; zoneWidthIn: number; zoneHeightIn: number } | null;
  colors: { detected?: string; hex: string; pantone?: string; share?: number }[];
  colorCount: number;
  customColorCount: number;
  estimate: { stitches: number; low: number; high: number; fillSqIn: number; satinSqIn: number; outlineIn: number } | null;
  background: string | null;
  insideAreasStitched: boolean;
};

export function decorations(spec: any): Decoration[] {
  if (!spec || typeof spec !== "object") return [];
  if (Array.isArray(spec.decorations)) {
    return spec.decorations.map((d: any) => ({
      method: d?.method ?? { key: "", name: "Customization", kind: "embroidery" },
      zone: d?.zone ?? null,
      size: d?.size ?? null,
      position: d?.position ?? null,
      colors: Array.isArray(d?.colors) ? d.colors : [],
      colorCount: Number(d?.colorCount) || (d?.colors?.length ?? 0),
      customColorCount: Number(d?.customColorCount) || 0,
      estimate: d?.estimate ?? null,
      background: d?.background ?? null,
      insideAreasStitched: !!d?.insideAreasStitched,
    }));
  }
  return [
    {
      method: { key: "standard_embroidery", name: "Embroidery", kind: "embroidery" },
      zone: spec.zone ?? null,
      size: spec.size ?? null,
      position: spec.position ?? null,
      colors: Array.isArray(spec.colors) ? spec.colors : [],
      colorCount: Number(spec.colorCount) || (spec.colors?.length ?? 0),
      customColorCount: 0,
      estimate: spec.estimate ?? null,
      background: spec.background ?? null,
      insideAreasStitched: !!spec.insideAreasStitched,
    },
  ];
}

export const firstDecoration = (spec: any) => decorations(spec)[0] ?? null;
