// Customization methods: shared types, defaults and the pricing engine (admin, server and storefront agree).

export type Tier = { min: number; price: number };
export type MethodKind = "embroidery" | "screen_print";

export type MethodData = {
  key: string;
  name: string;
  kind: MethodKind;
  description: string;
  enabled: boolean;
  position: number;
  minimum: number;
  minimumRule: "total" | "per_variant";
  tiers: Tier[];
  setupFee: number;
  includedStitches: number | null;
  perThousandStitches: number | null;
  includedColors: number;
  perExtraColor: number;
  customColorFee: number;
  maxColors: number | null;
  leadTime: string;
  colorNote: string;
};

export const KIND_LABELS: Record<MethodKind, string> = {
  embroidery: "Embroidery (priced by stitches and thread colors)",
  screen_print: "Screen print (priced by ink colors; size doesn't change price)",
};

// ApronWarehouse's published pricing (apronwarehouse.com/pages/customization, Oct 2026).
export const DEFAULT_METHODS: MethodData[] = [
  {
    key: "daystar_embroidery",
    name: "DayStar Premium Embroidery",
    kind: "embroidery",
    description: "Made-in-USA DayStar aprons. Pocket logos are stitched before the pocket is sewn on, so the pocket still works.",
    enabled: true,
    position: 1,
    minimum: 40,
    minimumRule: "per_variant",
    tiers: [
      { min: 40, price: 8.95 },
      { min: 80, price: 7.95 },
      { min: 120, price: 6.95 },
      { min: 320, price: 5.95 },
    ],
    setupFee: 35,
    includedStitches: 6000,
    perThousandStitches: 1,
    includedColors: 4,
    perExtraColor: 1,
    customColorFee: 0,
    maxColors: null,
    leadTime: "10–12 business days after proof approval",
    colorNote: "Thread is matched to your hex or Pantone color.",
  },
  {
    key: "standard_embroidery",
    name: "Embroidery",
    kind: "embroidery",
    description: "A durable, premium look for logos on any apron brand. Mix styles and colors to reach the minimum.",
    enabled: true,
    position: 2,
    minimum: 50,
    minimumRule: "total",
    tiers: [
      { min: 50, price: 8.95 },
      { min: 72, price: 7.95 },
      { min: 144, price: 6.95 },
      { min: 300, price: 5.95 },
    ],
    setupFee: 35,
    includedStitches: 6000,
    perThousandStitches: 1,
    includedColors: 4,
    perExtraColor: 1,
    customColorFee: 0,
    maxColors: null,
    leadTime: "7–10 business days after the aprons reach our decorator and the proof is approved",
    colorNote: "Thread is matched to your hex or Pantone color.",
  },
  {
    key: "screen_print",
    name: "Screen Printing",
    kind: "screen_print",
    description: "The lowest price per apron for bold logos with a few solid colors. Logo size doesn't change the price.",
    enabled: true,
    position: 3,
    minimum: 50,
    minimumRule: "total",
    tiers: [
      { min: 50, price: 6.95 },
      { min: 72, price: 5.95 },
      { min: 144, price: 4.95 },
      { min: 300, price: 3.95 },
    ],
    setupFee: 35,
    includedStitches: null,
    perThousandStitches: null,
    includedColors: 4,
    perExtraColor: 1,
    customColorFee: 1,
    maxColors: null,
    leadTime: "7–10 business days after the aprons reach our decorator and the proof is approved",
    colorNote: "Up to 4 stock ink colors included; a white underbase is added when needed at no charge. Custom Pantone inks are $1 per color per apron.",
  },
];

export type PriceInput = { quantity: number; stitches?: number; colors: number; customColors?: number };

export function priceFor(m: Pick<MethodData, "kind" | "tiers" | "setupFee" | "includedStitches" | "perThousandStitches" | "includedColors" | "perExtraColor" | "customColorFee" | "minimum">, p: PriceInput) {
  const tiers = [...(m.tiers ?? [])].sort((a, b) => a.min - b.min);
  let tier = tiers[0] ?? { min: 0, price: 0 };
  for (const t of tiers) if (p.quantity >= t.min) tier = t;
  const extraK =
    m.kind === "embroidery" && m.includedStitches != null
      ? Math.max(0, Math.ceil(((p.stitches ?? 0) - m.includedStitches) / 1000))
      : 0;
  const stitchCharge = extraK * (m.perThousandStitches ?? 0);
  const extraColors = Math.max(0, p.colors - m.includedColors);
  const customColors = m.kind === "screen_print" ? Math.max(0, p.customColors ?? 0) : 0;
  const perPiece = round2(tier.price + stitchCharge + extraColors * m.perExtraColor + customColors * (m.customColorFee ?? 0));
  return {
    tierPrice: tier.price,
    extraK,
    extraColors,
    customColors,
    perPiece,
    setupFee: m.setupFee,
    total: round2(perPiece * p.quantity + m.setupFee),
    belowMinimum: p.quantity < m.minimum,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Clean up a method from the admin form.
export function validateMethod(input: any): { data: MethodData; errors: string[] } {
  const errors: string[] = [];
  const n = (v: unknown, d: number | null = 0) => (v === "" || v == null || !isFinite(Number(v)) ? d : Number(v));
  const kind: MethodKind = input?.kind === "screen_print" ? "screen_print" : "embroidery";
  const tiers: Tier[] = (Array.isArray(input?.tiers) ? input.tiers : [])
    .map((t: any) => ({ min: Math.round(n(t?.min, NaN) as number), price: round2(n(t?.price, NaN) as number) }))
    .filter((t: Tier) => isFinite(t.min) && isFinite(t.price) && t.min > 0 && t.price >= 0)
    .sort((a: Tier, b: Tier) => a.min - b.min);
  const name = String(input?.name ?? "").trim().slice(0, 80);
  if (!name) errors.push("Give the method a name.");
  if (!tiers.length) errors.push("Add at least one price tier.");
  const minimum = Math.max(1, Math.round(n(input?.minimum, 1) as number));
  return {
    data: {
      key: String(input?.key ?? "").trim(),
      name,
      kind,
      description: String(input?.description ?? "").slice(0, 400),
      enabled: input?.enabled === true || input?.enabled === "on" || input?.enabled === "true",
      position: Math.round(n(input?.position, 0) as number),
      minimum,
      minimumRule: input?.minimumRule === "per_variant" ? "per_variant" : "total",
      tiers,
      setupFee: round2(n(input?.setupFee, 0) as number),
      includedStitches: kind === "embroidery" ? Math.round(n(input?.includedStitches, 6000) as number) : null,
      perThousandStitches: kind === "embroidery" ? round2(n(input?.perThousandStitches, 0) as number) : null,
      includedColors: Math.max(0, Math.round(n(input?.includedColors, 0) as number)),
      perExtraColor: round2(n(input?.perExtraColor, 0) as number),
      customColorFee: kind === "screen_print" ? round2(n(input?.customColorFee, 0) as number) : 0,
      maxColors: n(input?.maxColors, null) ? Math.round(n(input?.maxColors, null) as number) : null,
      leadTime: String(input?.leadTime ?? "").slice(0, 200),
      colorNote: String(input?.colorNote ?? "").slice(0, 400),
    },
    errors,
  };
}
