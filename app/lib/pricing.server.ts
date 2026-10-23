// Stitch estimator constants (embroidery methods). The storefront builder loads these from
// /apps/imprint/config. Method pricing lives in the Method table (see methods.ts / methods.server.ts).

export const ESTIMATOR = {
  fillPerSqIn: 1800,
  satinPerSqIn: 1100,
  runPerIn: 12,
  perColor: 60,
  base: 150,
  satinMaxWidthIn: 0.25,
  uncertainty: 0.2,
};
