import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deleteChart, getChart, listCharts, renameChart, saveChart } from "../lib/threads.server";
import { closeness, matchThread, normalizeHex, rowsFromCsv, toCsv, type ThreadRow } from "../lib/threads";

const MAX_CSV = 2 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const charts = await listCharts(session.shop);
  const methods = await prisma.method.findMany({ where: { shop: session.shop }, select: { name: true, threadChartId: true }, orderBy: { position: "asc" } });
  const full = await Promise.all(charts.map((c) => getChart(session.shop, c.id)));
  return {
    charts: full.filter(Boolean).map((c) => ({ ...c!, usedBy: methods.filter((m) => m.threadChartId === c!.id).map((m) => m.name) })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = String(f.get("intent") || "");
  const id = String(f.get("id") || "");
  const name = String(f.get("name") || "").trim().slice(0, 80);
  const brand = String(f.get("brand") || "").trim().slice(0, 40);

  if (intent === "delete") {
    await deleteChart(session.shop, id);
    return { ok: true, message: "Chart deleted" };
  }
  if (intent === "rename") {
    if (!name) return { ok: false, error: "Give the chart a name." };
    await renameChart(session.shop, id, name, brand);
    return { ok: true, message: "Saved" };
  }
  if (intent === "upload" || intent === "create") {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a CSV file to upload." };
    if (file.size > MAX_CSV) return { ok: false, error: "That file is over 2 MB. A thread chart CSV is usually much smaller; is it the right file?" };
    if (/\.(xlsx?|numbers|pdf)$/i.test(file.name)) return { ok: false, error: "Save the sheet as CSV first (in Excel: File › Save As › CSV), then upload that." };
    const { rows, errors, filledHex } = rowsFromCsv(await file.text());
    if (errors.length) return { ok: false, error: errors.join(" ") };
    const existing = intent === "upload" ? await getChart(session.shop, id) : null;
    if (intent === "upload" && !existing) return { ok: false, error: "Chart not found." };
    if (intent === "create" && !name) return { ok: false, error: "Give the chart a name." };
    await saveChart(session.shop, {
      id: existing?.id,
      name: existing?.name ?? name,
      brand: existing?.brand ?? brand,
      fileName: file.name,
      rows,
    });
    const noHex = rows.filter((r) => !r.hex).length;
    const was = existing ? ` (was ${existing.rowCount})` : "";
    return {
      ok: true,
      message: `${rows.length} rows saved${was}`,
      detail: `${rows.length} rows from ${file.name}${was}.${filledHex ? ` Hex filled from the Pantone code on ${filledHex} rows.` : ""}${noHex ? ` ${noHex} rows have no hex and an unknown Pantone code, so they only match when a customer types that code.` : ""}`,
    };
  }
  return { ok: false, error: "Unknown action" };
};

function download(name: string, rows: ThreadRow[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[^\w .()-]+/g, "").trim() + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export default function Threads() {
  const { charts } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const shopify = useAppBridge();
  const [test, setTest] = useState("");
  useEffect(() => {
    if (!result) return;
    if (result.ok) shopify.toast.show(result.message);
    else shopify.toast.show(result.error, { isError: true });
  }, [result]);

  const testHex = normalizeHex(test);
  const testColor = testHex ? { hex: testHex } : test.trim() ? { pantone: test.trim() } : null;

  return (
    <s-page heading="Thread charts">
      <s-section>
        <s-paragraph>
          Each chart lists a vendor's Pantone (PMS) colors and the thread number they use for each. A method uses its chart to
          suggest a thread for every color in a design; you'll see the suggestions on the design page and spec sheet. Customers
          never see thread numbers.
        </s-paragraph>
        <s-paragraph>
          To update a chart, download it, edit it in Excel or Google Sheets, save as CSV and upload it here. The upload replaces
          the whole chart. Columns: <code>pms</code>, <code>thread</code>, and optionally <code>hex</code> and <code>thread_name</code>.
          Leave hex blank and it's filled in from the Pantone code.
        </s-paragraph>
        {result?.ok && result.detail ? <p className="tc-ok">{result.detail}</p> : null}
        {result && !result.ok ? <p className="tc-err">{result.error}</p> : null}
      </s-section>

      {charts.map((c) => (
        <div className="tc-card" key={c.id}>
          <div className="tc-head">
            <div>
              <h2>{c.name}</h2>
              <p className="tc-meta">
                {c.rowCount} colors{c.brand ? ` · ${c.brand} thread` : ""} · updated {new Date(c.updatedAt).toLocaleDateString("en-US")}
                {c.fileName ? ` from ${c.fileName}` : ""}
              </p>
              <p className="tc-meta">{c.usedBy.length ? `Used by ${c.usedBy.join(", ")}` : "Not used by any method yet. Choose it on the Methods page."}</p>
            </div>
            <button type="button" className="tc-btn" onClick={() => download(c.name, c.rows)}>Download CSV</button>
          </div>
          <Form method="post" encType="multipart/form-data" className="tc-row">
            <input type="hidden" name="intent" value="upload" />
            <input type="hidden" name="id" value={c.id} />
            <label className="tc-f">
              <span>Upload a replacement</span>
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <button className="tc-btn tc-dark" type="submit" disabled={busy}>Replace chart</button>
          </Form>
          <details>
            <summary>Rename or delete</summary>
            <Form method="post" className="tc-row">
              <input type="hidden" name="intent" value="rename" />
              <input type="hidden" name="id" value={c.id} />
              <label className="tc-f"><span>Name</span><input name="name" defaultValue={c.name} required /></label>
              <label className="tc-f"><span>Thread brand</span><input name="brand" defaultValue={c.brand} placeholder="Isacord" /></label>
              <button className="tc-btn" type="submit" disabled={busy}>Save</button>
            </Form>
            <Form method="post" className="tc-row" onSubmit={(e) => { if (!confirm(`Delete ${c.name}? Download it first if you might need it.`)) e.preventDefault(); }}>
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={c.id} />
              <button className="tc-btn tc-danger" type="submit" disabled={busy}>Delete chart</button>
            </Form>
          </details>
        </div>
      ))}

      <div className="tc-card">
        <h2>Add a chart</h2>
        <Form method="post" encType="multipart/form-data" className="tc-row">
          <input type="hidden" name="intent" value="create" />
          <label className="tc-f"><span>Name</span><input name="name" placeholder="DayStar: Pantone to Gunold" required /></label>
          <label className="tc-f"><span>Thread brand</span><input name="brand" placeholder="Gunold" /></label>
          <label className="tc-f"><span>CSV file</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
          <button className="tc-btn tc-dark" type="submit" disabled={busy}>Add chart</button>
        </Form>
      </div>

      <div className="tc-card">
        <h2>Try a color</h2>
        <label className="tc-f tc-test">
          <span>Hex (like #C8102E) or Pantone (like 186 C)</span>
          <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="#C8102E" />
        </label>
        {testColor ? (
          <table className="tc-table">
            <thead><tr><th>Chart</th><th>Pantone</th><th>Thread</th><th>How close</th></tr></thead>
            <tbody>
              {charts.map((c) => {
                const m = matchThread(c.rows, testColor);
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{m ? <><span className="tc-sw" style={{ background: c.rows.find((r) => r.pms === m.pms)?.hex || "transparent" }} /> {m.pms}</> : "—"}</td>
                    <td>{m ? `${m.thread}${m.threadName ? ` ${m.threadName}` : ""}${m.alternates.length ? ` (or ${m.alternates.join(", ")})` : ""}` : "No match"}</td>
                    <td>{m ? (m.via === "pms" ? "Exact Pantone" : closeness(m.distance)) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <style>{`
        .tc-card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06)}
        .tc-card h2{font-size:16px;margin:0 0 4px}
        .tc-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
        .tc-meta{margin:2px 0;color:#616161;font-size:13px}
        .tc-row{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin:8px 0}
        .tc-f{display:flex;flex-direction:column;gap:4px;font-size:13px}
        .tc-f span{font-weight:500;color:#303030}
        .tc-f input{font:inherit;font-size:14px;padding:6px 10px;border:1px solid #8a8a8a;border-radius:8px;background:#fff}
        .tc-test input{width:260px}
        .tc-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:1px solid #8a8a8a;background:#fff;cursor:pointer;white-space:nowrap}
        .tc-dark{background:#303030;color:#fff;border-color:#303030}
        .tc-danger{color:#8e1f0b;border-color:#e0b3aa}
        .tc-btn:disabled{opacity:.5}
        details summary{cursor:pointer;font-size:13px;color:#303030;margin-top:8px}
        .tc-ok{background:#e8f5e9;border-radius:8px;padding:8px 12px;font-size:13px}
        .tc-err{background:#fde8e4;border-radius:8px;padding:8px 12px;font-size:13px}
        .tc-table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
        .tc-table th,.tc-table td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
        .tc-sw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #999;vertical-align:-2px}
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
