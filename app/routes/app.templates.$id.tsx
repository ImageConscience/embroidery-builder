import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  assignTemplate,
  deleteTemplate,
  ensureDefinitions,
  getTemplate,
  resolveTarget,
  saveTemplate,
  unassignTemplate,
  type Target,
  type TemplateProduct,
} from "../lib/templates.server";
import {
  photoWidthFromCalibration,
  ratioMismatch,
  round,
  validateTemplate,
  zoneBoxInches,
  type Calibration,
  type TemplateData,
  type Zone,
} from "../lib/templates";

const gidFor = (id: string) => `gid://shopify/Metaobject/${id}`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDefinitions(admin, session.shop);
  const lists = await admin
    .graphql(`#graphql
      query filterValues { productTypes(first: 250) { nodes } productVendors(first: 250) { nodes } }`)
    .then((r) => r.json())
    .then((j: any) => ({ types: (j?.data?.productTypes?.nodes ?? []) as string[], vendors: (j?.data?.productVendors?.nodes ?? []) as string[] }))
    .catch(() => ({ types: [] as string[], vendors: [] as string[] }));

  if (params.id === "new") {
    return { id: null, template: null, products: [] as TemplateProduct[], productsMore: false, ...lists };
  }
  const found = await getTemplate(admin, gidFor(params.id ?? ""));
  if (!found) throw new Response("Template not found", { status: 404 });
  return { id: found.template.id, template: found.template, products: found.products, productsMore: found.productsMore, ...lists };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json().catch(() => ({}))) as any;
  const id = params.id === "new" ? null : gidFor(params.id ?? "");
  try {
    switch (body.intent) {
      case "save": {
        const { data, errors } = validateTemplate(body.template);
        if (errors.length) return { intent: "save", ok: false, errors };
        const savedId = await saveTemplate(admin, session.shop, id, data);
        return { intent: "save", ok: true, id: savedId.split("/").pop() };
      }
      case "preview":
      case "apply": {
        if (!id) return { intent: body.intent, ok: false, errors: ["Save the template first."] };
        const products = await resolveTarget(admin, body.target as Target);
        const toChange = products.filter((p) => p.current !== id);
        if (body.intent === "preview") {
          return {
            intent: "preview",
            ok: true,
            total: products.length,
            already: products.length - toChange.length,
            replacing: toChange.filter((p) => p.current).length,
            noPhoto: products.filter((p) => !p.hasPhoto).length,
            sample: products.slice(0, 8).map((p) => p.title),
          };
        }
        const r = await assignTemplate(admin, id, toChange.map((p) => p.id));
        return { intent: "apply", ok: !r.failed.length, applied: r.done, errors: r.failed.slice(0, 5) };
      }
      case "unassign": {
        const ids = (Array.isArray(body.productIds) ? body.productIds : []).filter((s: unknown) => typeof s === "string");
        const n = await unassignTemplate(admin, ids);
        return { intent: "unassign", ok: true, removed: n };
      }
      case "delete": {
        if (!id) return { intent: "delete", ok: false, errors: ["Nothing to delete."] };
        const found = await getTemplate(admin, id);
        if (found?.products.length) return { intent: "delete", ok: false, errors: ["Remove this template from its products before deleting it."] };
        await deleteTemplate(admin, id);
        return { intent: "delete", ok: true };
      }
    }
    return { intent: body.intent, ok: false, errors: ["Unknown action"] };
  } catch (e: any) {
    console.error("[templates]", e);
    return { intent: body.intent, ok: false, errors: [e?.message ?? "Something went wrong."] };
  }
};

/* ---------------- editor ---------------- */

const EMPTY: TemplateData = { name: "", photoWidthIn: 0, photoRatio: 0, zones: [], calibration: null, referenceImage: "", notes: "" };
type Mode = "select" | "ruler";
type Drag =
  | { kind: "draw"; x0: number; y0: number }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; corner: "nw" | "ne" | "sw" | "se" }
  | { kind: "ruler" }
  | null;

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const fmt = (n: number) => (isFinite(n) && n > 0 ? n.toFixed(1) : "—");

export default function TemplateEditor() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<any>();
  const applyFetcher = useFetcher<any>();

  const [tpl, setTpl] = useState<TemplateData>(() => (data.template ? { ...EMPTY, ...data.template } : EMPTY));
  const [sel, setSel] = useState<string | null>(() => data.template?.zones?.[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("select");
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<Drag>(null);
  const overlay = useRef<HTMLDivElement>(null);

  // Reset when navigating between templates.
  useEffect(() => {
    setTpl(data.template ? { ...EMPTY, ...data.template } : EMPTY);
    setSel(data.template?.zones?.[0]?.id ?? null);
    setDirty(false);
  }, [data.id]);

  const update = (fn: (t: TemplateData) => TemplateData) => {
    setTpl((t) => fn(t));
    setDirty(true);
  };
  const zone = tpl.zones.find((z) => z.id === sel) ?? null;
  const setZone = (id: string, patch: Partial<Zone>) =>
    update((t) => ({ ...t, zones: t.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }));

  // Save result
  useEffect(() => {
    const r = fetcher.data;
    if (!r || fetcher.state !== "idle") return;
    if (r.intent === "save" && r.ok) {
      setDirty(false);
      shopify.toast.show("Template saved");
      if (!data.id && r.id) navigate(`/app/templates/${r.id}`);
    } else if (r.intent === "delete" && r.ok) {
      shopify.toast.show("Template deleted");
      navigate("/app/templates");
    } else if (r.intent === "unassign" && r.ok) {
      shopify.toast.show(`Removed from ${r.removed} product${r.removed === 1 ? "" : "s"}`);
    }
  }, [fetcher.data, fetcher.state]);

  const save = () => fetcher.submit({ intent: "save", template: tpl } as any, { method: "post", encType: "application/json" });

  /* ----- reference photo ----- */
  const uploadFetcher = useFetcher<any>();
  const photosFetcher = useFetcher<any>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [chooser, setChooser] = useState(false);
  const [photoQuery, setPhotoQuery] = useState("");

  const applyPhoto = (src: string, title?: string) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalHeight / img.naturalWidth;
      update((t) => {
        const keepScale = t.photoRatio && Math.abs(ratio - t.photoRatio) / t.photoRatio < 0.03;
        return {
          ...t,
          referenceImage: src,
          photoRatio: round(ratio, 4),
          name: t.name || (title ? `${title} layout` : ""),
          ...(keepScale ? {} : { calibration: null, photoWidthIn: 0 }),
        };
      });
      setChooser(false);
    };
    img.onerror = () => shopify.toast.show("That photo couldn't be loaded", { isError: true });
    img.src = src;
  };
  const uploadPhoto = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    uploadFetcher.submit(fd, { method: "post", action: "/app/api/photos", encType: "multipart/form-data" });
  };
  useEffect(() => {
    const r = uploadFetcher.data;
    if (uploadFetcher.state !== "idle" || !r) return;
    if (!r.ok) shopify.toast.show(r.error ?? "Upload failed", { isError: true });
    else if (r.url) applyPhoto(r.url);
    else shopify.toast.show("Shopify is still processing the image. Try again in a moment.", { isError: true });
    if (fileInput.current) fileInput.current.value = "";
  }, [uploadFetcher.state, uploadFetcher.data]);
  const openChooser = () => {
    setChooser(true);
    if (!photosFetcher.data && photosFetcher.state === "idle") photosFetcher.load("/app/api/photos");
  };
  const uploading = uploadFetcher.state !== "idle";
  const photoProducts: any[] = (photosFetcher.data?.products ?? []).filter((p: any) =>
    p.title.toLowerCase().includes(photoQuery.trim().toLowerCase()),
  );
  const photoButtons = (
    <div className="tpe-inline">
      <s-button variant="primary" onClick={() => fileInput.current?.click()} loading={uploading || undefined}>
        Upload from computer
      </s-button>
      <s-button onClick={openChooser}>Choose from products with an embroidery photo</s-button>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
    </div>
  );
  const chooserPanel = chooser ? (
    <div className="tpe-chooser">
      <div className="tpe-inline">
        <input className="tpe-search" placeholder="Filter products" value={photoQuery} onChange={(e) => setPhotoQuery(e.target.value)} />
        <button type="button" className="tpe-x" onClick={() => setChooser(false)}>Close</button>
      </div>
      {photosFetcher.state !== "idle" && !photosFetcher.data ? (
        <p className="tpe-note">Loading products…</p>
      ) : photoProducts.length === 0 ? (
        <p className="tpe-note">
          {photosFetcher.data?.products?.length
            ? "No products match."
            : "No products have an embroidery mockup photo yet. Upload a photo from your computer instead, or add photos to products (product metafield embroidery.mockup_photo)."}
        </p>
      ) : (
        <div className="tpe-photo-grid">
          {photoProducts.slice(0, 120).map((p: any) => (
            <button key={p.id} type="button" onClick={() => applyPhoto(p.url, p.title)} title={p.title}>
              <img src={`${p.url}${p.url.includes("?") ? "&" : "?"}width=200`} alt="" />
              <span>{p.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  /* ----- pointer editing on the photo ----- */
  const point = (e: React.PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!tpl.referenceImage) return;
    const p = point(e);
    const target = e.target as HTMLElement;
    overlay.current!.setPointerCapture(e.pointerId);
    if (mode === "ruler") {
      drag.current = { kind: "ruler" };
      update((t) => ({ ...t, calibration: { x1: p.x, y1: p.y, x2: p.x, y2: p.y, inches: t.calibration?.inches ?? 0 } }));
      return;
    }
    const zid = target.dataset.zone;
    const corner = target.dataset.corner as any;
    if (zid && corner) {
      setSel(zid);
      drag.current = { kind: "resize", id: zid, corner };
    } else if (zid) {
      const z = tpl.zones.find((q) => q.id === zid)!;
      setSel(zid);
      drag.current = { kind: "move", id: zid, dx: p.x - z.x, dy: p.y - z.y };
    } else {
      drag.current = { kind: "draw", x0: p.x, y0: p.y };
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.kind === "ruler") {
      update((t) => {
        const c = { ...(t.calibration as Calibration), x2: p.x, y2: p.y };
        return { ...t, calibration: c, photoWidthIn: round(photoWidthFromCalibration(c, t.photoRatio)) };
      });
    } else if (d.kind === "draw") {
      setDraft({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
    } else if (d.kind === "move") {
      update((t) => ({
        ...t,
        zones: t.zones.map((z) =>
          z.id === d.id ? { ...z, x: round(clamp(p.x - d.dx, 0, 1 - z.w), 4), y: round(clamp(p.y - d.dy, 0, 1 - z.h), 4) } : z,
        ),
      }));
    } else if (d.kind === "resize") {
      update((t) => ({
        ...t,
        zones: t.zones.map((z) => {
          if (z.id !== d.id) return z;
          let x1 = z.x, y1 = z.y, x2 = z.x + z.w, y2 = z.y + z.h;
          if (d.corner.includes("w")) x1 = Math.min(p.x, x2 - 0.02);
          if (d.corner.includes("e")) x2 = Math.max(p.x, x1 + 0.02);
          if (d.corner.includes("n")) y1 = Math.min(p.y, y2 - 0.02);
          if (d.corner.includes("s")) y2 = Math.max(p.y, y1 + 0.02);
          return { ...z, x: round(x1, 4), y: round(y1, 4), w: round(x2 - x1, 4), h: round(y2 - y1, 4) };
        }),
      }));
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "draw" && draft) {
      if (draft.w > 0.02 && draft.h > 0.02) {
        const n = tpl.zones.length + 1;
        const id = `location-${Date.now().toString(36)}`;
        const box = zoneBoxInches(draft as Zone, tpl);
        const z: Zone = {
          id,
          label: `Location ${n}`,
          x: round(draft.x, 4),
          y: round(draft.y, 4),
          w: round(draft.w, 4),
          h: round(draft.h, 4),
          maxW: round(Math.max(0.5, box.w || 4), 1),
          maxH: round(Math.max(0.5, box.h || 4), 1),
        };
        update((t) => ({ ...t, zones: [...t.zones, z] }));
        setSel(id);
      }
      setDraft(null);
    }
    if (d?.kind === "ruler") setMode("select");
  };

  const removeZone = (id: string) => {
    update((t) => ({ ...t, zones: t.zones.filter((z) => z.id !== id) }));
    setSel(null);
  };

  const photoHeightIn = tpl.photoWidthIn * tpl.photoRatio;
  const errors: string[] = fetcher.data?.intent === "save" && !fetcher.data.ok ? fetcher.data.errors ?? [] : [];
  const saving = fetcher.state !== "idle";

  const steps = [
    { done: !!tpl.referenceImage, text: "Add the embroidery photo" },
    { done: tpl.photoWidthIn > 1, text: "Set the scale" },
    { done: tpl.zones.length > 0, text: "Draw the locations" },
    { done: !!data.id && !dirty, text: "Save" },
    { done: data.products.length > 0, text: "Apply to products" },
  ];

  return (
    <s-page heading={data.id ? tpl.name || "Template" : "New location template"}>
      <s-link slot="breadcrumb-actions" href="/app/templates">
        Location templates
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving || undefined} disabled={!dirty && !!data.id}>
        Save
      </s-button>

      <ol className="tpe-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "is-done" : ""}>
            <span>{s.done ? "✓" : i + 1}</span>
            {s.text}
          </li>
        ))}
      </ol>

      {errors.length ? (
        <s-banner tone="critical" heading="Not saved yet">
          {errors.map((e: string) => (
            <s-paragraph key={e}>{e}</s-paragraph>
          ))}
        </s-banner>
      ) : null}

      <div className="tpe">
        <div className="tpe-photo-col">
          {tpl.referenceImage ? (
            <>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
              <div className="tpe-toolbar">
                <button type="button" className={mode === "select" ? "is-on" : ""} onClick={() => setMode("select")}>
                  Draw & edit locations
                </button>
                <button type="button" className={mode === "ruler" ? "is-on" : ""} onClick={() => setMode("ruler")}>
                  Measuring line
                </button>
                <button type="button" onClick={() => fileInput.current?.click()}>
                  {uploading ? "Uploading…" : "Upload a different photo"}
                </button>
                <button type="button" onClick={openChooser}>
                  Choose another product's photo
                </button>
              </div>
              {chooserPanel}
              <div className="tpe-photo" style={{ aspectRatio: `1 / ${tpl.photoRatio || 1.2}` }}>
                <img src={tpl.referenceImage} alt="Reference product photo" draggable={false} />
                <div
                  ref={overlay}
                  className={`tpe-overlay mode-${mode}`}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  {tpl.zones.map((z) => (
                    <div
                      key={z.id}
                      data-zone={z.id}
                      className={`tpe-zone${z.id === sel ? " is-sel" : ""}`}
                      style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}
                    >
                      <span className="tpe-zone-label" data-zone={z.id}>
                        {z.label}
                      </span>
                      {z.id === sel
                        ? (["nw", "ne", "sw", "se"] as const).map((c) => <i key={c} data-zone={z.id} data-corner={c} className={`tpe-h tpe-h-${c}`} />)
                        : null}
                    </div>
                  ))}
                  {draft ? (
                    <div className="tpe-zone is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />
                  ) : null}
                  {tpl.calibration ? (
                    <svg className="tpe-ruler" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <line
                        x1={tpl.calibration.x1 * 100}
                        y1={tpl.calibration.y1 * 100}
                        x2={tpl.calibration.x2 * 100}
                        y2={tpl.calibration.y2 * 100}
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  ) : null}
                </div>
              </div>
              <p className="tpe-hint">
                {mode === "ruler"
                  ? "Drag a line across something whose real size you know, like the apron's width at the top of the bib. Then enter its length on the right."
                  : "Drag on an empty part of the photo to draw a location. Drag a box to move it, or a corner to resize it."}
              </p>
            </>
          ) : (
            <div className="tpe-empty">
              <p>
                <strong>Start with the embroidery photo.</strong> Use the same photo layout the products will use for the
                builder (their embroidery mockup photo). It doesn't have to be one of the product's gallery photos.
              </p>
              {photoButtons}
              {chooserPanel}
            </div>
          )}
        </div>

        <div className="tpe-side">
          <s-section heading="Template">
            <label className="tpe-field">
              <span>Name</span>
              <input value={tpl.name} maxLength={120} placeholder="Bib apron, front, 3:4 photo" onChange={(e) => update((t) => ({ ...t, name: e.target.value }))} />
            </label>
            <label className="tpe-field">
              <span>Notes for your team (optional)</span>
              <textarea rows={2} value={tpl.notes} onChange={(e) => update((t) => ({ ...t, notes: e.target.value }))} />
            </label>
          </s-section>

          <s-section heading="Scale">
            {tpl.calibration ? (
              <>
                <label className="tpe-field">
                  <span>The measuring line is this long in real life (inches)</span>
                  <input
                    type="number"
                    min="0.5"
                    step="0.25"
                    value={tpl.calibration.inches || ""}
                    onChange={(e) =>
                      update((t) => {
                        const c = { ...(t.calibration as Calibration), inches: parseFloat(e.target.value) || 0 };
                        return { ...t, calibration: c, photoWidthIn: round(photoWidthFromCalibration(c, t.photoRatio)) };
                      })
                    }
                  />
                </label>
                <p className="tpe-note">
                  {tpl.photoWidthIn > 1
                    ? `The whole photo covers about ${fmt(tpl.photoWidthIn)}″ × ${fmt(photoHeightIn)}″.`
                    : "Enter the length to set the scale."}
                </p>
              </>
            ) : (
              <p className="tpe-note">
                {tpl.referenceImage
                  ? "Choose Measuring line above the photo, then drag across something you know the size of."
                  : "Choose a photo first."}
              </p>
            )}
          </s-section>

          <s-section heading={`Locations (${tpl.zones.length})`}>
            {tpl.zones.length === 0 ? <p className="tpe-note">Drag on the photo to draw the first location, for example the chest.</p> : null}
            <div className="tpe-chips">
              {tpl.zones.map((z) => (
                <button key={z.id} type="button" className={z.id === sel ? "is-on" : ""} onClick={() => setSel(z.id)}>
                  {z.label}
                </button>
              ))}
            </div>
            {zone ? (
              <div className="tpe-zone-form">
                <label className="tpe-field">
                  <span>Name customers see</span>
                  <input value={zone.label} maxLength={60} onChange={(e) => setZone(zone.id, { label: e.target.value })} />
                </label>
                {(() => {
                  const box = zoneBoxInches(zone, tpl);
                  return (
                    <>
                      <p className="tpe-note">Area drawn: {tpl.photoWidthIn > 1 ? `${fmt(box.w)}″ wide × ${fmt(box.h)}″ tall` : "set the scale to see inches"}</p>
                      <div className="tpe-row">
                        <label className="tpe-field">
                          <span>Largest logo width (in)</span>
                          <input type="number" min="0.5" step="0.25" value={zone.maxW} onChange={(e) => setZone(zone.id, { maxW: parseFloat(e.target.value) || 0 })} />
                        </label>
                        <label className="tpe-field">
                          <span>Largest logo height (in)</span>
                          <input type="number" min="0.5" step="0.25" value={zone.maxH} onChange={(e) => setZone(zone.id, { maxH: parseFloat(e.target.value) || 0 })} />
                        </label>
                      </div>
                      {tpl.photoWidthIn > 1 && (zone.maxW > box.w + 0.05 || zone.maxH > box.h + 0.05) ? (
                        <p className="tpe-warn">The largest logo is bigger than the area drawn, so it will be limited to the area ({fmt(box.w)}″ × {fmt(box.h)}″). Draw a bigger area or lower the size.</p>
                      ) : null}
                      <label className="tpe-field">
                        <span>Smallest logo width (in, optional)</span>
                        <input type="number" min="0" step="0.25" value={zone.minW ?? ""} onChange={(e) => setZone(zone.id, { minW: parseFloat(e.target.value) || undefined })} />
                      </label>
                    </>
                  );
                })()}
                <s-button tone="critical" variant="tertiary" onClick={() => removeZone(zone.id)}>
                  Delete this location
                </s-button>
              </div>
            ) : null}
          </s-section>
        </div>
      </div>

      {data.id ? (
        <ApplySection
          fetcher={applyFetcher}
          mainFetcher={fetcher}
          products={data.products}
          productsMore={data.productsMore}
          types={data.types}
          vendors={data.vendors}
          photoRatio={tpl.photoRatio}
          dirty={dirty}
        />
      ) : null}

      <style>{EDITOR_CSS}</style>
    </s-page>
  );
}

/* ---------------- apply to products ---------------- */

function ApplySection(props: {
  fetcher: ReturnType<typeof useFetcher<any>>;
  mainFetcher: ReturnType<typeof useFetcher<any>>;
  products: TemplateProduct[];
  productsMore: boolean;
  types: string[];
  vendors: string[];
  photoRatio: number;
  dirty: boolean;
}) {
  const { fetcher, mainFetcher, products } = props;
  const shopify = useAppBridge();
  const [kind, setKind] = useState<Target["kind"]>("products");
  const [picked, setPicked] = useState<{ ids: string[]; label: string }>({ ids: [], label: "" });
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const target: Target | null = useMemo(() => {
    if (kind === "products") return picked.ids.length ? { kind, ids: picked.ids } : null;
    if (kind === "collection") return picked.ids[0] ? { kind, id: picked.ids[0] } : null;
    return value.trim() ? { kind, value: value.trim() } : null;
  }, [kind, picked, value]);

  useEffect(() => {
    setPicked({ ids: [], label: "" });
    setValue("");
  }, [kind]);

  const r = fetcher.data;
  useEffect(() => {
    if (fetcher.state !== "idle" || !r) return;
    if (r.intent === "apply" && r.ok) shopify.toast.show(`Template applied to ${r.applied} product${r.applied === 1 ? "" : "s"}`);
  }, [fetcher.state, r]);

  const pick = async () => {
    if (kind === "products") {
      const sel: any = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: true,
        filter: { variants: false },
        selectionIds: picked.ids.map((id) => ({ id })),
      });
      if (sel) setPicked({ ids: sel.map((p: any) => p.id), label: `${sel.length} product${sel.length === 1 ? "" : "s"} selected` });
    } else {
      const sel: any = await shopify.resourcePicker({ type: "collection", action: "select", multiple: false });
      if (sel?.[0]) setPicked({ ids: [sel[0].id], label: sel[0].title });
    }
  };
  const submit = (intent: string) => target && fetcher.submit({ intent, target } as any, { method: "post", encType: "application/json" });
  const preview = r?.intent === "preview" && r.ok ? r : null;
  const busy = fetcher.state !== "idle";
  const selectedIds = Object.keys(checked).filter((k) => checked[k]);
  const mismatched = products.filter((p) => ratioMismatch(props.photoRatio, p.width, p.height));

  return (
    <>
      <s-section heading="Apply to products">
        <p className="tpe-note">
          Apply this template to every product that uses the same photo layout. The builder shows on a product once it has
          both this template and an embroidery mockup photo. With Shopify's bulk editor or an import tool you can also set the
          product metafields <code>embroidery.location_template</code> and <code>embroidery.mockup_photo</code> (and
          <code>embroidery.mockup_photo</code> on variants for a photo per color).
        </p>
        {props.dirty ? <p className="tpe-warn">Save your changes first. Products use the saved version of the template.</p> : null}
        <div className="tpe-row">
          <label className="tpe-field">
            <span>Choose products by</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Target["kind"])}>
              <option value="products">Picking products</option>
              <option value="collection">Collection</option>
              <option value="product_type">Product type</option>
              <option value="vendor">Vendor</option>
              <option value="tag">Tag</option>
            </select>
          </label>
          {kind === "products" || kind === "collection" ? (
            <div className="tpe-field">
              <span>{kind === "products" ? "Products" : "Collection"}</span>
              <div className="tpe-inline">
                <s-button onClick={pick}>{kind === "products" ? "Pick products" : "Pick a collection"}</s-button>
                <span className="tpe-note">{picked.label}</span>
              </div>
            </div>
          ) : (
            <label className="tpe-field">
              <span>{kind === "product_type" ? "Product type" : kind === "vendor" ? "Vendor" : "Tag"}</span>
              <input list={`tpe-list-${kind}`} value={value} onChange={(e) => setValue(e.target.value)} />
              <datalist id={`tpe-list-${kind}`}>
                {(kind === "product_type" ? props.types : kind === "vendor" ? props.vendors : []).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
          )}
        </div>
        <div className="tpe-inline">
          <s-button onClick={() => submit("preview")} disabled={!target || busy || undefined}>
            Preview
          </s-button>
          {preview && preview.total - preview.already > 0 ? (
            <s-button variant="primary" onClick={() => submit("apply")} disabled={busy || props.dirty || undefined} loading={busy || undefined}>
              Apply to {preview.total - preview.already} product{preview.total - preview.already === 1 ? "" : "s"}
            </s-button>
          ) : null}
        </div>
        {preview ? (
          <p className="tpe-note">
            {preview.total === 0
              ? "No products match."
              : `${preview.total} product${preview.total === 1 ? "" : "s"} match. ${preview.already ? `${preview.already} already use this template. ` : ""}${preview.replacing ? `${preview.replacing} currently use a different template and will switch to this one. ` : ""}${preview.noPhoto ? `${preview.noPhoto} don't have an embroidery photo yet, so the builder stays hidden on them until one is added. ` : ""}For example: ${preview.sample.join(", ")}${preview.total > preview.sample.length ? "…" : ""}`}
          </p>
        ) : null}
        {r && !r.ok && r.errors?.length ? <p className="tpe-warn">{r.errors.join(" ")}</p> : null}
      </s-section>

      <s-section heading={`Products using this template (${products.length}${props.productsMore ? "+" : ""})`}>
        {mismatched.length ? (
          <p className="tpe-warn">
            {mismatched.length} product{mismatched.length === 1 ? " has a photo" : "s have photos"} with a different shape from the reference photo, so
            the locations may not line up. Check them below.
          </p>
        ) : null}
        {products.length === 0 ? (
          <p className="tpe-note">None yet.</p>
        ) : (
          <>
            <table className="tpe-table">
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${p.title}`} checked={!!checked[p.id]} onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))} />
                    </td>
                    <td>{p.hasPhoto && p.image ? <img src={`${p.image}${p.image.includes("?") ? "&" : "?"}width=80`} alt="" /> : null}</td>
                    <td>
                      {p.title}
                      {p.status !== "ACTIVE" ? <span className="tpe-tag">{p.status.toLowerCase()}</span> : null}
                    </td>
                    <td>
                      {!p.hasPhoto ? (
                        <span className="tpe-tag is-warn">No embroidery photo: builder hidden</span>
                      ) : ratioMismatch(props.photoRatio, p.width, p.height) ? (
                        <span className="tpe-tag is-warn">Photo shape differs</span>
                      ) : (
                        <span className="tpe-tag is-ok">Ready</span>
                      )}
                    </td>
                    <td>
                      <PhotoUpload productId={p.id} label={p.hasPhoto ? "Replace photo" : "Add photo"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <s-button
              tone="critical"
              disabled={!selectedIds.length || undefined}
              onClick={() => {
                mainFetcher.submit({ intent: "unassign", productIds: selectedIds } as any, { method: "post", encType: "application/json" });
                setChecked({});
              }}
            >
              Remove template from {selectedIds.length || ""} selected
            </s-button>
          </>
        )}
      </s-section>

      {products.length === 0 ? (
        <s-section heading="Delete template">
          <s-button tone="critical" variant="secondary" onClick={() => mainFetcher.submit({ intent: "delete" } as any, { method: "post", encType: "application/json" })}>
            Delete this template
          </s-button>
        </s-section>
      ) : null}
    </>
  );
}

// Upload an embroidery mockup photo for one product (sets its embroidery.mockup_photo metafield).
function PhotoUpload({ productId, label }: { productId: string; label: string }) {
  const f = useFetcher<any>();
  const shopify = useAppBridge();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (f.state !== "idle" || !f.data) return;
    if (f.data.ok) shopify.toast.show("Embroidery photo saved");
    else shopify.toast.show(f.data.error ?? "Upload failed", { isError: true });
    if (input.current) input.current.value = "";
  }, [f.state, f.data]);
  return (
    <>
      <button type="button" className="tpe-small" disabled={f.state !== "idle"} onClick={() => input.current?.click()}>
        {f.state !== "idle" ? "Uploading…" : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("photo", file);
          fd.append("productId", productId);
          f.submit(fd, { method: "post", action: "/app/api/photos", encType: "multipart/form-data" });
        }}
      />
    </>
  );
}

const EDITOR_CSS = `
.tpe-small{font:inherit;font-size:12px;padding:3px 8px;border:1px solid #8a8a8a;border-radius:6px;background:#fff;cursor:pointer;white-space:nowrap}
.tpe-tag.is-ok{background:#cdfee1;color:#0c5132}
.tpe-chooser{border:1px solid #e3e3e3;border-radius:10px;padding:12px;margin:0 0 12px;background:#fafafa;text-align:left;width:100%;box-sizing:border-box}
.tpe-search{font:inherit;font-size:13px;padding:6px 10px;border:1px solid #8a8a8a;border-radius:8px;flex:1}
.tpe-x{border:0;background:none;color:#005bd3;cursor:pointer;font:inherit;font-size:13px}
.tpe-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:360px;overflow:auto}
.tpe-photo-grid button{border:1px solid #e3e3e3;background:#fff;border-radius:8px;padding:6px;cursor:pointer;display:flex;flex-direction:column;gap:4px;font:inherit;font-size:11px;text-align:left}
.tpe-photo-grid button:hover{border-color:#005bd3}
.tpe-photo-grid img{width:100%;height:110px;object-fit:contain;background:#f1f1f1;border-radius:4px}
.tpe-photo-grid span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tpe-photo-cell{display:flex;align-items:center;gap:8px}
.tpe-steps{display:flex;flex-wrap:wrap;gap:8px 20px;list-style:none;margin:0 0 16px;padding:0;font-size:13px;color:#616161}
.tpe-steps li{display:flex;align-items:center;gap:6px}
.tpe-steps li span{width:22px;height:22px;border-radius:50%;background:#e3e3e3;color:#303030;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:12px}
.tpe-steps li.is-done{color:#303030}
.tpe-steps li.is-done span{background:#29845a;color:#fff}
.tpe{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,1fr);gap:16px;align-items:start}
@media (max-width:900px){.tpe{grid-template-columns:1fr}}
.tpe-photo-col{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06)}
.tpe-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.tpe-toolbar button,.tpe-chips button{border:1px solid #c9c9c9;background:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
.tpe-toolbar button.is-on,.tpe-chips button.is-on{background:#303030;border-color:#303030;color:#fff}
.tpe-photo{position:relative;width:100%;max-width:620px;margin:0 auto;background:#f1f1f1;border-radius:8px;overflow:hidden;user-select:none}
.tpe-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
.tpe-overlay{position:absolute;inset:0;touch-action:none;cursor:crosshair}
.tpe-overlay.mode-ruler{cursor:copy}
.tpe-zone{position:absolute;border:2px dashed #e07a5f;background:rgba(224,122,95,.12);cursor:move;box-sizing:border-box}
.tpe-zone.is-sel{border-style:solid;background:rgba(224,122,95,.22)}
.tpe-zone.is-draft{border-color:#005bd3;background:rgba(0,91,211,.12)}
.tpe-overlay.mode-ruler .tpe-zone{pointer-events:none}
.tpe-zone-label{position:absolute;left:4px;top:4px;background:#e07a5f;color:#fff;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;white-space:nowrap}
.tpe-h{position:absolute;width:12px;height:12px;background:#fff;border:2px solid #e07a5f;border-radius:2px}
.tpe-h-nw{left:-7px;top:-7px;cursor:nwse-resize}.tpe-h-se{right:-7px;bottom:-7px;cursor:nwse-resize}
.tpe-h-ne{right:-7px;top:-7px;cursor:nesw-resize}.tpe-h-sw{left:-7px;bottom:-7px;cursor:nesw-resize}
.tpe-ruler{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.tpe-ruler line{stroke:#005bd3;stroke-width:3;stroke-linecap:round}
.tpe-hint{font-size:13px;color:#616161;margin:10px 0 0}
.tpe-empty{padding:32px 8px;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center}
.tpe-empty p{max-width:420px;color:#4a4a4a;margin:0}
.tpe-side{display:flex;flex-direction:column;gap:16px}
.tpe-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;font-size:13px;flex:1}
.tpe-field>span{color:#303030;font-weight:500}
.tpe-field input,.tpe-field textarea,.tpe-field select{font:inherit;font-size:14px;padding:6px 10px;border:1px solid #8a8a8a;border-radius:8px;background:#fff}
.tpe-row{display:flex;gap:12px;flex-wrap:wrap}
.tpe-inline{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.tpe-note{font-size:13px;color:#616161;margin:4px 0 8px}
.tpe-warn{font-size:13px;color:#8e1f0b;background:#fee9e8;border-radius:8px;padding:8px 10px;margin:4px 0 10px}
.tpe-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.tpe-zone-form{border-top:1px solid #e3e3e3;padding-top:12px}
.tpe-table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px}
.tpe-table td{padding:6px 8px;border-bottom:1px solid #ebebeb;vertical-align:middle}
.tpe-table img{width:40px;height:40px;object-fit:cover;border-radius:6px;display:block}
.tpe-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 6px;border-radius:6px;background:#e3e3e3}
.tpe-tag.is-warn{background:#ffeb78;color:#4f4700}
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
