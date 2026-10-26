# Imprint Customizer

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

- **Methods** (admin > Methods): each customization method has its own pricing and rules. Defaults are ApronWarehouse's published pricing: DayStar Premium Embroidery (40 minimum per style and color, 40/80/120/320 tiers, pockets), Embroidery (standard, 50 minimum), Screen Printing (50 minimum, ink colors, custom Pantone fee). Pricing types: embroidery (stitches + thread colors) and screen print (ink colors; size doesn't change price). Stored in the app database; checkout is priced from here.
- **Location templates** (admin > Location templates): each template belongs to one method and marks that method's locations on one photo framing. Each location has a maximum width and height (inches) and optional limits: smallest width, most colors and minimum quantity (both override the method defaults), most stitches (embroidery), quantity in multiples of (e.g. DayStar pockets: 40). Templates are Shopify metaobjects (`imprint_location_template`); products list theirs in `imprint.location_templates` (at most one per method) and the builder draws on `imprint.mockup_photo` (product, or per variant for each color). Apply in bulk in the app or with any tool that writes metafields. Data from the embroidery-only version (`embroidery.*`) is copied over automatically as Embroidery templates.
- **Theme block "Imprint Customizer"** (`extensions/embroidery-builder`): product pages with a template and a mockup photo get a "Customize with your logo" button. Steps: method (skipped when a product offers one), apron color and location, upload (remove or keep a plain background), place and size within the location's limits, thread or ink colors (hex suggested, optional Pantone), price, checkout. Limits (colors, stitches, quantity multiples, minimum) block checkout with a clear message.
- **App embed "Imprint Customizer switch"** (Theme settings > App embeds): master on/off switch per theme.
- **Checkout** (`/proxy/submit`): re-checks the design against the method and the product's template, prices it on the server, saves it (original logo, flat-color artwork, mockup to Shopify Files) and sends the customer to a draft-order checkout: apron line, "<Method>: <Location> (size)" line, setup line. Lines carry the design reference and a link to the customer's design page.
- **Design center** (admin home): every design with its method, mockup, stage, payment status and "Needs reply" flag; design page with specs, colors, stitch breakdown (embroidery), price, conversation, proof upload, customer link and production package (.zip with spec sheet).
- **Customer design page** (`https://<shop>/apps/imprint/design/<token>`): proof, approve or request changes, messages. No emails are sent.

## Endpoints

- `/health`: Railway health check
- `/app`: admin screens (inside Shopify admin)
- `/proxy/*`: storefront requests, reached at `https://<shop>/apps/imprint/*`
- `/proxy/ping`: confirms the app proxy is wired up
- `/proxy/submit`: storefront design submission (multipart POST)
- `/proxy/config`: enabled methods and estimator for the builder
- `/proxy/design/<token>`: the customer's design page (Liquid, through the app proxy)
- `/files/<id>/<kind>`: signed links to design files and the production package

## Notes

- Database migrations run on every start (`prisma migrate deploy`).
- Test on a development store first. Choose **Custom distribution** for apronwarehouse.com only when going live; that choice can't be changed.
