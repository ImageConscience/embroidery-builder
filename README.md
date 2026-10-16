# Embroidery Builder

Custom Shopify app for apronwarehouse.com. Customers upload a logo, place and size it within allowed embroidery locations, set colors (hex or Pantone), see a live stitch and price estimate, and submit the design for a quote.

Built on Shopify's React Router app template. Hosted on Railway (`embuild-app` + Postgres `embuild-db`). Pushes to `main` deploy automatically.

## One-time setup (Lee's PC)

1. Install Node 22+ and the Shopify CLI: `npm install -g @shopify/cli`
2. `git clone https://github.com/ImageConscience/embroidery-builder` then `cd embroidery-builder` and `npm install`
3. `npm run config:link` → pick the Partner organization → **Create a new app** → name it "Embroidery Builder". This fills `client_id` in `shopify.app.toml`.
4. `npm run deploy` → pushes the app settings (URLs, permissions, app proxy) to Shopify and releases a version.
5. Commit and push the updated `shopify.app.toml`.

## Railway variables (`embuild-app`)

| Variable | Value |
|---|---|
| `DATABASE_URL` | from `embuild-db` (already set) |
| `SHOPIFY_API_KEY` | app's Client ID (Dev Dashboard → app → Settings) |
| `SHOPIFY_API_SECRET` | app's Client secret |
| `SHOPIFY_APP_URL` | `https://embuild-app-production.up.railway.app` |
| `SCOPES` | `read_products,write_files,write_metaobject_definitions,write_metaobjects` |

The app does not start without `SHOPIFY_API_KEY`. Until these are set, Railway keeps the previous deploy running because the `/health` check fails.

## What's in the MVP

- **Theme block "Embroidery builder"** (`extensions/embroidery-builder`): adds a "Customize with your logo" button to product pages. Steps: apron color and location, upload (PNG/JPG/SVG preview; background removed), place and size within the location's limits, colors (suggested hex, optional Pantone), live stitch and price estimate, review and submit.
- **Submissions** (`/proxy/submit`): saves the design, uploads the original logo and the mockup to Shopify Files, and returns a reference like `EMB-1001`.
- **Admin**: Submissions list and detail page (mockup, specs, colors, customer, original logo download).

Locations, pricing and estimator constants are JSON settings on the theme block for now. Location x/y/w/h are fractions of the product photo; `widthIn` is the real width of that box in inches.

## Endpoints

- `/health`: Railway health check
- `/app`: admin screens (inside Shopify admin)
- `/proxy/*`: storefront requests, reached at `https://<shop>/apps/embroidery/*`
- `/proxy/ping`: confirms the app proxy is wired up
- `/proxy/submit`: storefront design submission (multipart POST)

## Notes

- Database migrations run on every start (`prisma migrate deploy`).
- Test on a development store first. Choose **Custom distribution** for apronwarehouse.com only when going live; that choice can't be changed.
