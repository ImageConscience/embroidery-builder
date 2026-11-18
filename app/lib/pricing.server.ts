// Stitch estimator constants (embroidery methods). The storefront builder loads these from
// /apps/imprint/config. Method pricing lives in the Method table (see methods.ts / methods.server.ts).

// Calibrated Nov 2026 on Lindsey's 150 Wilcom production worksheets (147 usable): each design run
// through the builder's own logo analysis at its real width, as flat artwork on white and as the
// stitch render. Old constants read about 26% low (median); these are centered (median ratio 0.99),
// median error about 19%, 80% of designs within 0.6x to 1.4x. Outline length and color changes
// matter more than the old constants assumed, plain fill a little less. Digitizing style still
// moves the count (Whistle Stop as satin vs fill), so the proof is the final word.
export const ESTIMATOR = {
  fillPerSqIn: 1200,
  satinPerSqIn: 620,
  runPerIn: 75,
  perColor: 150,
  base: 0,
  satinMaxWidthIn: 0.25,
  uncertainty: 0.3,
};
