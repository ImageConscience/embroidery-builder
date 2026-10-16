// Server-side source of truth for embroidery pricing and the stitch estimator.
// The storefront builder loads these from /apps/embroidery/config, and checkout is priced here,
// so the price can't be changed from the browser.

export const PRICING = {
  minimum: 50,
  tiers: [
    { min: 50, price: 8.95 },
    { min: 72, price: 7.95 },
    { min: 144, price: 6.95 },
    { min: 300, price: 5.95 },
  ],
  includedStitches: 6000,
  perThousandStitches: 1,
  includedColors: 4,
  perExtraColor: 1,
  setupFee: 35,
};

export const ESTIMATOR = {
  fillPerSqIn: 1800,
  satinPerSqIn: 1100,
  runPerIn: 12,
  perColor: 60,
  base: 150,
  satinMaxWidthIn: 0.25,
  uncertainty: 0.2,
};

export function priceEmbroidery(quantity: number, stitches: number, colors: number) {
  const tiers = [...PRICING.tiers].sort((a, b) => a.min - b.min);
  let tier = tiers[0];
  for (const t of tiers) if (quantity >= t.min) tier = t;
  const extraK = Math.max(0, Math.ceil((stitches - PRICING.includedStitches) / 1000));
  const extraColors = Math.max(0, colors - PRICING.includedColors);
  const perApron = round2(tier.price + extraK * PRICING.perThousandStitches + extraColors * PRICING.perExtraColor);
  return {
    tierPrice: tier.price,
    extraK,
    extraColors,
    perApron,
    setupFee: PRICING.setupFee,
    embroideryTotal: round2(perApron * quantity + PRICING.setupFee),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
