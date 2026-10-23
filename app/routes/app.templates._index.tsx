import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureDefinitions, listTemplates } from "../lib/templates.server";
import { listMethods } from "../lib/methods.server";
import { zoneBoxInches } from "../lib/templates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  let setupError: string | null = null;
  try {
    await ensureDefinitions(admin, session.shop);
  } catch (e: any) {
    setupError = e?.message ?? String(e);
  }
  const templates = setupError ? [] : await listTemplates(admin);
  const methods = (await listMethods(session.shop)).map((m) => ({ key: m.key, name: m.name, enabled: m.enabled }));
  return { templates, setupError, methods };
};

const numericId = (gid: string) => gid.split("/").pop();

export default function Templates() {
  const { templates, setupError, methods } = useLoaderData<typeof loader>();
  const groups = [
    ...methods.map((m) => ({ key: m.key, name: m.name, enabled: m.enabled, items: templates.filter((t: any) => t.method === m.key) })),
    { key: "", name: "No method yet", enabled: true, items: templates.filter((t: any) => !methods.some((m) => m.key === t.method)) },
  ].filter((g) => g.key || g.items.length);
  return (
    <s-page heading="Location templates">
      <s-button slot="primary-action" variant="primary" href="/app/templates/new">
        New template
      </s-button>
      {setupError ? (
        <s-banner tone="critical" heading="Templates aren't set up yet">
          <s-paragraph>
            The app couldn't create its template storage in Shopify ({setupError}). This usually means the app
            needs its latest permissions approved. Open the app again from Apps in the Shopify admin and approve the
            update.
          </s-paragraph>
        </s-banner>
      ) : null}
      <s-section>
        <s-paragraph>
          A template marks where one method can put a logo on one style of product photo. Make one template per method
          and photo layout (for example "Bib apron front: Screen printing") and apply it to every product photographed the
          same way. A product offers the methods it has templates for; products without a template don't show the builder.
        </s-paragraph>
      </s-section>
      {groups.map((g) => (
        <section key={g.key || "none"} className="tpl-group">
          <div className="tpl-group-head">
            <h2>
              {g.name}
              {g.enabled ? "" : <span className="tpl-off">not offered yet</span>}
            </h2>
            {g.key ? <Link to={`/app/templates/new?method=${g.key}`}>New {g.name} template</Link> : null}
          </div>
          {g.items.length === 0 ? (
            <p className="tpl-empty">No templates for this method yet.</p>
          ) : (
            <div className="tpl-grid">
              {g.items.map((t: any) => (
                <Link key={t.id} className="tpl-card" to={`/app/templates/${numericId(t.id)}`}>
                  <div className="tpl-thumb">
                    {t.referenceImage ? (
                      <div className="tpl-photo">
                        <img src={t.referenceImage} alt="" />
                        {t.zones.map((z: any) => (
                          <span
                            key={z.id}
                            className="tpl-zone"
                            style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <span>No photo</span>
                    )}
                  </div>
                  <div className="tpl-meta">
                    <strong>{t.name}</strong>
                    <span>
                      {t.zones.length} location{t.zones.length === 1 ? "" : "s"}:{" "}
                      {t.zones
                        .map((z: any) => {
                          const b = zoneBoxInches(z, t);
                          return `${z.label} (up to ${Math.min(z.maxW, b.w).toFixed(1)}″ × ${Math.min(z.maxH, b.h).toFixed(1)}″)`;
                        })
                        .join(", ")}
                    </span>
                    <span>
                      Used on {t.usage}
                      {t.usageMore ? "+" : ""} product{t.usage === 1 ? "" : "s"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
      <style>{`
        .tpl-group{margin-top:20px}
        .tpl-group-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
        .tpl-group-head h2{font-size:15px;margin:0}
        .tpl-group-head a{font-size:13px;color:#005bd3}
        .tpl-off{margin-left:8px;font-size:11px;font-weight:500;background:#ebebeb;border-radius:6px;padding:1px 6px}
        .tpl-empty{font-size:13px;color:#616161;margin:8px 0}
        .tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:10px}
        .tpl-card{display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06);overflow:hidden;color:inherit;text-decoration:none}
        .tpl-card:hover{box-shadow:0 0 0 2px #005bd3}
        .tpl-thumb{height:220px;background:#f1f1f1;display:flex;align-items:center;justify-content:center;color:#616161}
        .tpl-photo{position:relative;height:100%;display:inline-block}
        .tpl-photo img{height:100%;display:block}
        .tpl-zone{position:absolute;border:2px dashed #e07a5f;background:rgba(224,122,95,.15)}
        .tpl-meta{display:flex;flex-direction:column;gap:4px;padding:12px;font-size:13px;color:#4a4a4a}
        .tpl-meta strong{color:#303030;font-size:14px}
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
