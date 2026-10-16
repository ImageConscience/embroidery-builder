# Embroidery Builder

Custom Shopify app for apronwarehouse.com: customers upload a logo, place and size it within allowed embroidery locations, choose thread colors (hex or Pantone), see a live stitch and price estimate, and submit the design for a quote.

## Status

Placeholder deploy. `server.js` only answers `/` and `/health` so Railway can build and run the service. It will be replaced by the Shopify app scaffold.

## Deploy

Pushes to `main` deploy to Railway. Railway sets `PORT`; the server listens on it.
