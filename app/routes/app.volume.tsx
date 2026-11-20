import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getVolume, saveVolume } from "../lib/volume.server";
import { groupVolume, volumeFromCsv, volumePercent, volumeToCsv, type VolumeRow } from "../lib/volume";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return getVolume(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a CSV file to upload." };
  if (file.size > 1024 * 1024) return { ok: false, error: "That file is over 1 MB; is it the right one?" };
  if (/\.(xlsx?|numbers|pdf)$/i.test(file.name)) return { ok: false, error: "Save the sheet as CSV first (in Excel: File › Save As › CSV), then upload that." };
  const { rows, errors } = volumeFromCsv(await file.text());
  if (errors.length && !rows.length) return { ok: false, error: errors.join(" ") };
  await saveVolume(session.shop, rows, file.name);
  const groups = groupVolume(rows).length;
  return { ok: true, message: `${rows.length} tiers saved`, detail: `${rows.length} tiers in ${groups} groups from ${file.name}.${errors.length ? ` Skipped: ${errors.join(" ")}` : ""}` };
};

function download(rows: VolumeRow[]) {
  const blob = new Blob([volumeToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Volume discounts.csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export default function Volume() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const shopify = useAppBridge();
  const [qty, setQty] = useState(48);
  useEffect(() => {
    if (!result) return;
    if (result.ok) shopify.toast.show(result.message);
    else shopify.toast.show(result.error, { isError: true });
  }, [result]);
  const groups = groupVolume(d.rows);

  return (
    <s-page heading="Volume discounts">
      <s-section>
        <s-paragraph>
          Customized orders check out through their own order, so the store's volume discount app doesn't apply to them. This
          sheet copies its tiers: the matching percent comes off the aprons (not the decoration or setup) in the customizer's price
          and at checkout.
        </s-paragraph>
        <s-paragraph>
          Each row is one tier: <code>match_type</code> (collection, vendor or all), <code>match</code> (the collection handle or
          vendor name), <code>min_qty</code>, <code>percent_off</code> and an optional <code>label</code>. Rows with the same match
          form one tier list. The first list that fits a product wins, so put specific collections (like DayStar Denim &amp; Canvas)
          above the vendor's general list. Download, edit, save as CSV and upload to replace the whole sheet.
        </s-paragraph>
        {result?.ok && result.detail ? <p className="vd-ok">{result.detail}</p> : null}
        {result && !result.ok ? <p className="vd-err">{result.error}</p> : null}
      </s-section>

      <div className="vd-card">
        <div className="vd-head">
          <div>
            <h2>{d.rows.length} tiers in {groups.length} groups</h2>
            <p className="vd-meta">{d.updatedAt ? `Updated ${new Date(d.updatedAt).toLocaleDateString("en-US")}` : "Not set up yet"}{d.fileName ? ` · ${d.fileName}` : ""}</p>
          </div>
          <button type="button" className="vd-btn" onClick={() => download(d.rows)} disabled={!d.rows.length}>Download CSV</button>
        </div>
        <Form method="post" encType="multipart/form-data" className="vd-row">
          <label className="vd-f">
            <span>Upload a replacement</span>
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <button className="vd-btn vd-dark" type="submit" disabled={nav.state !== "idle"}>Replace sheet</button>
        </Form>
      </div>

      <div className="vd-card">
        <div className="vd-head">
          <h2>Tiers</h2>
          <label className="vd-f vd-inline">
            <span>Check a quantity</span>
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </label>
        </div>
        <table className="vd-table">
          <thead><tr><th>Applies to</th><th>Tiers</th><th>At {qty}</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.type + g.match}>
                <td>
                  <strong>{g.label || g.match || "Everything"}</strong>
                  <br /><span className="vd-meta">{g.type === "all" ? "All products" : `${g.type}: ${g.match}`}</span>
                </td>
                <td>{g.tiers.map((t) => `${t.min}+ ${t.percent}%`).join(" · ")}</td>
                <td>{volumePercent(g, qty).percent ? `${volumePercent(g, qty).percent}% off` : "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .vd-card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06)}
        .vd-card h2{font-size:16px;margin:0 0 4px}
        .vd-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap}
        .vd-meta{margin:2px 0;color:#616161;font-size:13px}
        .vd-row{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end}
        .vd-f{display:flex;flex-direction:column;gap:4px;font-size:13px}
        .vd-f span{font-weight:500}
        .vd-f input{font:inherit;font-size:14px;padding:6px 10px;border:1px solid #8a8a8a;border-radius:8px;background:#fff}
        .vd-inline input{width:110px}
        .vd-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:1px solid #8a8a8a;background:#fff;cursor:pointer;white-space:nowrap}
        .vd-dark{background:#303030;color:#fff;border-color:#303030}
        .vd-btn:disabled{opacity:.5}
        .vd-ok{background:#e8f5e9;border-radius:8px;padding:8px 12px;font-size:13px}
        .vd-err{background:#fde8e4;border-radius:8px;padding:8px 12px;font-size:13px}
        .vd-table{border-collapse:collapse;width:100%;font-size:13px}
        .vd-table th,.vd-table td{text-align:left;padding:8px;border-bottom:1px solid #eee;vertical-align:top}
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
