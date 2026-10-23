import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listMethods, saveMethod } from "../lib/methods.server";
import { KIND_LABELS, validateMethod, type MethodData } from "../lib/methods";
import { slug } from "../lib/templates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { methods: await listMethods(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const get = (k: string) => f.get(k)?.toString() ?? "";
  const tiers = [0, 1, 2, 3, 4, 5].map((i) => ({ min: get(`tier${i}min`), price: get(`tier${i}price`) })).filter((t) => t.min !== "" && t.price !== "");
  const isNew = get("isNew") === "1";
  const existing = await listMethods(session.shop);
  let key = get("key");
  if (isNew) {
    key = slug(get("name")).replace(/-/g, "_") || "method";
    while (existing.some((m) => m.key === key)) key += "_2";
  } else if (!existing.some((m) => m.key === key)) {
    return { ok: false, error: "Unknown method" };
  }
  const { data, errors } = validateMethod({
    key,
    name: get("name"),
    kind: get("kind"),
    description: get("description"),
    enabled: f.get("enabled") === "on",
    position: get("position"),
    minimum: get("minimum"),
    minimumRule: get("minimumRule"),
    tiers,
    setupFee: get("setupFee"),
    includedStitches: get("includedStitches"),
    perThousandStitches: get("perThousandStitches"),
    includedColors: get("includedColors"),
    perExtraColor: get("perExtraColor"),
    customColorFee: get("customColorFee"),
    maxColors: get("maxColors"),
    leadTime: get("leadTime"),
    colorNote: get("colorNote"),
  });
  if (errors.length) return { ok: false, error: errors.join(" ") };
  await saveMethod(session.shop, data);
  return { ok: true, message: `${data.name} saved` };
};

export default function Methods() {
  const { methods } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const shopify = useAppBridge();
  useEffect(() => {
    if (!result) return;
    if (result.ok) shopify.toast.show((result as any).message);
    else shopify.toast.show((result as any).error, { isError: true });
  }, [result]);

  const blank: MethodData = {
    key: "",
    name: "",
    kind: "embroidery",
    description: "",
    enabled: false,
    position: methods.length + 1,
    minimum: 50,
    minimumRule: "total",
    tiers: [{ min: 50, price: 0 }],
    setupFee: 0,
    includedStitches: 6000,
    perThousandStitches: 1,
    includedColors: 4,
    perExtraColor: 1,
    customColorFee: 0,
    maxColors: null,
    leadTime: "",
    colorNote: "",
  };

  return (
    <s-page heading="Methods">
      <s-section>
        <s-paragraph>
          Each method has its own pricing and rules, and its own location templates. Customers choose a method first; a
          product offers the methods it has a location template for. Prices here are what checkout charges.
        </s-paragraph>
      </s-section>
      {methods.map((m) => (
        <MethodForm key={m.key} m={m} busy={nav.state !== "idle"} />
      ))}
      <details className="mt-new">
        <summary>Add a method</summary>
        <MethodForm m={blank} isNew busy={nav.state !== "idle"} />
      </details>
      <style>{`
        .mt-card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06)}
        .mt-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
        .mt-head h2{font-size:16px;margin:0}
        .mt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 16px}
        .mt-f{display:flex;flex-direction:column;gap:4px;font-size:13px}
        .mt-f span{font-weight:500;color:#303030}
        .mt-f small{color:#616161}
        .mt-f input,.mt-f select,.mt-f textarea{font:inherit;font-size:14px;padding:6px 10px;border:1px solid #8a8a8a;border-radius:8px;background:#fff}
        .mt-wide{grid-column:1/-1}
        .mt-tiers{display:flex;flex-wrap:wrap;gap:8px}
        .mt-tiers div{display:flex;gap:4px;align-items:center;font-size:13px}
        .mt-tiers input{width:70px;font:inherit;font-size:14px;padding:5px 8px;border:1px solid #8a8a8a;border-radius:8px}
        .mt-actions{display:flex;justify-content:flex-end;margin-top:12px}
        .mt-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:0;background:#303030;color:#fff;cursor:pointer}
        .mt-btn:disabled{opacity:.5}
        .mt-check{display:flex;gap:6px;align-items:center;font-size:13px}
        .mt-new summary{cursor:pointer;font-weight:600;margin:8px 0 12px}
      `}</style>
    </s-page>
  );
}

function MethodForm({ m, isNew, busy }: { m: MethodData; isNew?: boolean; busy: boolean }) {
  const tiers = [...m.tiers, ...Array(Math.max(0, 6 - m.tiers.length)).fill({ min: "", price: "" })].slice(0, 6);
  return (
    <Form method="post" className="mt-card" key={JSON.stringify(m)}>
      <input type="hidden" name="key" value={m.key} />
      {isNew ? <input type="hidden" name="isNew" value="1" /> : null}
      <div className="mt-head">
        <h2>{isNew ? "New method" : m.name}</h2>
        <label className="mt-check">
          <input type="checkbox" name="enabled" defaultChecked={m.enabled} /> Offered to customers
        </label>
      </div>
      <div className="mt-grid">
        <label className="mt-f">
          <span>Name customers see</span>
          <input name="name" defaultValue={m.name} required />
        </label>
        <label className="mt-f">
          <span>Pricing type</span>
          <select name="kind" defaultValue={m.kind}>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="mt-f">
          <span>Order in the list</span>
          <input name="position" type="number" defaultValue={m.position} />
        </label>
        <label className="mt-f mt-wide">
          <span>Short description ("best for")</span>
          <textarea name="description" rows={2} defaultValue={m.description} />
        </label>
        <div className="mt-f mt-wide">
          <span>Price per piece by quantity</span>
          <div className="mt-tiers">
            {tiers.map((t: any, i: number) => (
              <div key={i}>
                <input name={`tier${i}min`} type="number" min="1" placeholder="qty" defaultValue={t.min} aria-label={`Tier ${i + 1} quantity`} />+ at $
                <input name={`tier${i}price`} type="number" min="0" step="0.01" placeholder="price" defaultValue={t.price} aria-label={`Tier ${i + 1} price`} />
              </div>
            ))}
          </div>
        </div>
        <label className="mt-f">
          <span>Minimum quantity</span>
          <input name="minimum" type="number" min="1" defaultValue={m.minimum} />
        </label>
        <label className="mt-f">
          <span>Minimum applies to</span>
          <select name="minimumRule" defaultValue={m.minimumRule}>
            <option value="total">The whole order</option>
            <option value="per_variant">Each style and color</option>
          </select>
        </label>
        <label className="mt-f">
          <span>Setup fee (one time, $)</span>
          <input name="setupFee" type="number" min="0" step="0.01" defaultValue={m.setupFee} />
        </label>
        <label className="mt-f">
          <span>Stitches included</span>
          <input name="includedStitches" type="number" min="0" defaultValue={m.includedStitches ?? ""} />
          <small>Embroidery only</small>
        </label>
        <label className="mt-f">
          <span>Per extra 1,000 stitches, per piece ($)</span>
          <input name="perThousandStitches" type="number" min="0" step="0.01" defaultValue={m.perThousandStitches ?? ""} />
          <small>Embroidery only</small>
        </label>
        <label className="mt-f">
          <span>Colors included</span>
          <input name="includedColors" type="number" min="0" defaultValue={m.includedColors} />
        </label>
        <label className="mt-f">
          <span>Per extra color, per piece ($)</span>
          <input name="perExtraColor" type="number" min="0" step="0.01" defaultValue={m.perExtraColor} />
        </label>
        <label className="mt-f">
          <span>Per custom Pantone ink, per piece ($)</span>
          <input name="customColorFee" type="number" min="0" step="0.01" defaultValue={m.customColorFee} />
          <small>Screen print only</small>
        </label>
        <label className="mt-f">
          <span>Most colors allowed</span>
          <input name="maxColors" type="number" min="1" defaultValue={m.maxColors ?? ""} placeholder="No limit" />
          <small>Locations can set a lower limit</small>
        </label>
        <label className="mt-f mt-wide">
          <span>Production time shown to customers</span>
          <input name="leadTime" defaultValue={m.leadTime} />
        </label>
        <label className="mt-f mt-wide">
          <span>Color note shown on the colors step</span>
          <input name="colorNote" defaultValue={m.colorNote} />
        </label>
      </div>
      <div className="mt-actions">
        <button className="mt-btn" type="submit" disabled={busy}>{isNew ? "Add method" : "Save"}</button>
      </div>
    </Form>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
