-- Placeholder limit: at most 3 colors on one design unless a method or location says otherwise.
UPDATE "Method" SET "maxColors" = 3 WHERE "maxColors" IS NULL;

-- No stock ink list: inks are matched to the customer's hex or Pantone like thread, with no Pantone surcharge
-- (only where the original default is unchanged).
UPDATE "Method" SET "customColorFee" = 0,
  "colorNote" = 'Ink is matched to your hex or Pantone color. A white underbase is added when needed at no charge.'
WHERE "key" = 'screen_print' AND "customColorFee" = 1
  AND "colorNote" = 'Up to 4 stock ink colors included; a white underbase is added when needed at no charge. Custom Pantone inks are $1 per color per apron.';
