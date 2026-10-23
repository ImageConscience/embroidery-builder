# Imprint Customizer roadmap

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

## Shipped: methods, phase A (Oct 23)
- Renamed to Imprint Customizer; Shopify data under `imprint.*` (old `embroidery.*` data copied over)
- Methods with their own pricing and rules (DayStar Premium Embroidery, Embroidery, Screen Printing), editable in admin
- Location templates belong to a method; per-location max size and optional min width, max colors, max stitches, quantity multiples
- Builder: choose the method first; switch later without re-uploading; screen-print ink colors and custom Pantone fee
- Server re-checks every design against the method and template before pricing checkout
- Design data stored as a list of decorations (one for now; front + back later)

## Methods: next phases
- Get from ApronWarehouse: real max print/embroidery sizes per location, stock ink color list, max ink colors, whether screen print can go on pockets, how "40 per style and color" applies to multi-color orders
- Screen print: gradient/photo detection with a suggestion to simplify the art; stock ink picker
- Several decorations per order (e.g. embroidered chest + printed back), priced per decoration
- "Help me choose" after upload (suggest a method from the logo's colors and detail); side-by-side price comparison
- More methods if ApronWarehouse adds them (sublimation, DTF): full-color handling, variant eligibility, resolution check at print size

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
