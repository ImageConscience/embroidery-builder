// Location templates: shared types and geometry (used by the admin editor and the server).
//
// A template describes one photo framing (for example "Bib apron, front, 3:4 photo") and the
// embroidery locations on it. Boxes are stored as fractions of the photo, plus the real width of
// the whole photo in inches, so one template works for every product photographed the same way.

export type Zone = {
  id: string;
  label: string;
  // Box position and size as fractions of the photo (0–1).
  x: number;
  y: number;
  w: number;
  h: number;
  // Largest logo allowed in this location, inches.
  maxW: number;
  maxH: number;
  // Smallest logo allowed, inches (optional).
  minW?: number;
};

export type Calibration = { x1: number; y1: number; x2: number; y2: number; inches: number };

export type TemplateData = {
  name: string;
  photoWidthIn: number;
  photoRatio: number; // photo height / width
  zones: Zone[];
  calibration: Calibration | null;
  referenceImage: string;
  notes: string;
};

export type Template = TemplateData & { id: string; handle: string; updatedAt: string };

export const TEMPLATE_TYPE = "embroidery_location_template";
export const MF_NAMESPACE = "embroidery";
export const MF_KEY = "location_template";

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Real size of a zone box in inches.
export function zoneBoxInches(z: Zone, t: Pick<TemplateData, "photoWidthIn" | "photoRatio">) {
  return { w: z.w * t.photoWidthIn, h: z.h * t.photoRatio * t.photoWidthIn };
}

// Length of the calibration line measured in "photo widths".
export function calibrationLength(c: Calibration, photoRatio: number) {
  const dx = c.x2 - c.x1;
  const dy = (c.y2 - c.y1) * photoRatio;
  return Math.sqrt(dx * dx + dy * dy);
}

export function photoWidthFromCalibration(c: Calibration, photoRatio: number) {
  const len = calibrationLength(c, photoRatio);
  return len > 0.01 && c.inches > 0 ? c.inches / len : 0;
}

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "location"
  );
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const num = (v: unknown, d = 0) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : d);

// Clean up template data from the editor before saving. Returns a list of problems too.
export function validateTemplate(input: any): { data: TemplateData; errors: string[] } {
  const errors: string[] = [];
  const name = String(input?.name ?? "").trim().slice(0, 120);
  if (!name) errors.push("Give the template a name.");
  const photoRatio = num(input?.photoRatio, 0);
  if (!(photoRatio > 0.2 && photoRatio < 5)) errors.push("Choose a reference photo.");
  const photoWidthIn = num(input?.photoWidthIn, 0);
  if (!(photoWidthIn > 1 && photoWidthIn < 200)) errors.push("Set the scale: measure something on the photo and enter its real length.");
  const seen = new Set<string>();
  const zones: Zone[] = (Array.isArray(input?.zones) ? input.zones : []).slice(0, 12).map((z: any, i: number) => {
    const label = String(z?.label ?? "").trim().slice(0, 60) || `Location ${i + 1}`;
    let id = slug(String(z?.id || label));
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const x = clamp01(num(z?.x)), y = clamp01(num(z?.y));
    const w = Math.max(0.01, Math.min(1 - x, num(z?.w, 0.1)));
    const h = Math.max(0.01, Math.min(1 - y, num(z?.h, 0.1)));
    const box = zoneBoxInches({ x, y, w, h } as Zone, { photoWidthIn, photoRatio });
    const maxW = round(Math.max(0.5, Math.min(num(z?.maxW, box.w), box.w || 99)));
    const maxH = round(Math.max(0.5, Math.min(num(z?.maxH, box.h), box.h || 99)));
    const minW = num(z?.minW, 0) > 0 ? round(Math.min(num(z?.minW), maxW)) : undefined;
    return { id, label, x: round(x, 4), y: round(y, 4), w: round(w, 4), h: round(h, 4), maxW, maxH, ...(minW ? { minW } : {}) };
  });
  if (!zones.length) errors.push("Draw at least one embroidery location on the photo.");
  const c = input?.calibration;
  const calibration: Calibration | null =
    c && [c.x1, c.y1, c.x2, c.y2, c.inches].every((v) => isFinite(+v))
      ? { x1: round(clamp01(+c.x1), 4), y1: round(clamp01(+c.y1), 4), x2: round(clamp01(+c.x2), 4), y2: round(clamp01(+c.y2), 4), inches: round(+c.inches) }
      : null;
  return {
    data: {
      name,
      photoWidthIn: round(photoWidthIn),
      photoRatio: round(photoRatio, 4),
      zones,
      calibration,
      referenceImage: String(input?.referenceImage ?? "").slice(0, 2000),
      notes: String(input?.notes ?? "").slice(0, 2000),
    },
    errors,
  };
}

// True when a product photo is framed differently enough that the template boxes would drift.
export function ratioMismatch(templateRatio: number, width?: number | null, height?: number | null) {
  if (!width || !height || !templateRatio) return false;
  return Math.abs(height / width - templateRatio) / templateRatio > 0.03;
}
