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
| `SCOPES` | `read_products,write_files,write_metaobject_definitions,write_metaobjects,write_draft_orders` |

The app does not start without `SHOPIFY_API_KEY`. Until these are set, Railway keeps the previous deploy running because the `/health` check fails.

## What's built

- **Theme block "Embroidery builder"** (`extensions/embroidery-builder`): adds a "Customize with your logo" button to product pages that have a location template. Steps: apron color and location, upload (PNG/JPG/SVG preview; a plain background can be removed or kept as part of the design), place and size within the location's limits, colors (suggested hex, optional Pantone), live stitch and price estimate, review and checkout.
- **App embed "Embroidery builder switch"** (Theme settings > App embeds): the master on/off switch per theme. Off: the builder is hidden on every product page of that theme, even where the block is placed.
- **Checkout** (`/proxy/submit`): saves the design (original logo, flat-color artwork, mockup to Shopify Files), prices it on the server and sends the customer to a draft-order checkout: apron line, embroidery line, setup line. The embroidery line carries a link to the customer's design page.
- **Location templates** (admin > Location templates): draw locations on a reference product photo, set the scale with a measuring line, and apply the template to products by picking them, by collection, product type, vendor or tag. Templates are Shopify metaobjects (`embroidery_location_template`); products point to one with the product metafield `embroidery.location_template`, so other tools (bulk editor, Matrixify, CSV) can assign them too. One template covers every product photographed with the same framing. The builder draws on each product's embroidery mockup photo (`embroidery.mockup_photo`, a file metafield on the product, optionally per variant for each color), which can differ from the gallery photos; the template editor can start from an uploaded photo or from a product that already has one, and photos can be uploaded per product from the template page. Products without both a template and a mockup photo don't show the builder.
- **Design center** (admin home): every design with its mockup, stage (New, In review, Proof sent, Changes requested, Approved, In production, Done, Cancelled), payment status and a "Needs reply" flag. The design page shows the mockup, artwork, proof, specs, thread colors, the stitch estimate breakdown and price, a conversation with internal notes, proof upload, the customer link, and a production package (.zip with original logo, artwork, mockup, proof, printable spec sheet and spec JSON).
- **Customer design page** (`https://<shop>/apps/embroidery/design/<token>`, rendered in the store theme): the customer sees the mockup or proof, approves it or asks for changes, and messages the team. No emails are sent; staff copy the link from the design page.

## Endpoints

- `/health`: Railway health check
- `/app`: admin screens (inside Shopify admin)
- `/proxy/*`: storefront requests, reached at `https://<shop>/apps/embroidery/*`
- `/proxy/ping`: confirms the app proxy is wired up
- `/proxy/submit`: storefront design submission (multipart POST)
- `/proxy/design/<token>`: the customer's design page (Liquid, through the app proxy)
- `/files/<id>/<kind>`: signed links to design files and the production package

## Notes

- Database migrations run on every start (`prisma migrate deploy`).
- Test on a development store first. Choose **Custom distribution** for apronwarehouse.com only when going live; that choice can't be changed.
