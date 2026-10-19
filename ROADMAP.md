# Embroidery Builder roadmap

## Shipped (MVP)
- Product page block "Embroidery builder": apron color + location, logo upload (background removal, color detection), place/size within limits, hex/Pantone colors, stitch + price estimate, review and submit
- Submissions saved; logo + mockup in Shopify Files; admin Submissions list and detail

## Shipped: pay at the end of the flow
- Builder ends in Shopify checkout (draft order): aprons + embroidery per apron + one-time setup, priced on the server
- Estimate is charged as the final price (decided Oct 16)
- Order lines carry the design reference (EMB-####), location, size, colors and estimated stitches
- Admin shows checkout started / paid with the order number

## Shipped: design center and templates (Oct 19)
- Background choice in the builder: remove a plain background or keep it as part of the design (kept backgrounds are counted in stitches and colors)
- Location templates: admin editor (reference photo, measuring line for scale, draw/resize locations, max/min logo size), stored as metaobjects and assigned with the product metafield `embroidery.location_template`; bulk apply by products, collection, product type, vendor or tag; warns when a product photo is framed differently
- Design center: gallery with stages and "Needs reply", design page with mockup/artwork/proof, specs, stitch breakdown, price, conversation and internal notes, proof upload, production package (.zip)
- Customer design page through the app proxy: view proof, approve, request changes, message the team; link on the order confirmation
- Payment stays at checkout; proof approval comes after payment and before production

## Checkout follow-ups
- Server-side stitch recount from the uploaded logo (today the server trusts the builder's estimate; price tiers and fees are server-side)
- Apply ApronWarehouse's apron volume discounts inside the embroidery checkout
- Option to add an embroidered design to the regular cart alongside other items

## Save designs and accounts
- "Save design" available at any step of the builder
- Saving prompts the customer to sign in or create an account (account creation driven by saving)
- Account holders see saved, unfinished designs on their account page and can resume, check out or delete them
- Later: team collaboration (share a design with coworkers, comment, approve before ordering)

## Customer accounts: "My designs"
- Customer account page (customer account UI extension) listing the customer's designs and orders
- Saved logos: reuse a logo on a new apron without re-uploading
- Reorder a past design in one click
- Email notifications for proofs and replies (today: in-app messages and links only)
- Design format for the embroiderer/digitizer once decided (DST, EMB, PDF…)

## Builder improvements
- PDF / AI / EPS preview (server conversion with Ghostscript)
- Estimator calibration from past jobs with known stitch counts
- Text-only embroidery (name/wording with font choice), multiple locations per apron

## Operations
- Email notifications to the team on new orders/designs
- Production spec sheet PDF per order
