// Railway health check. No Shopify auth, no database.
export const loader = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
