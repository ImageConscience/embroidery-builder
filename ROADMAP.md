# Embroidery Builder roadmap

## Shipped (MVP)
- Product page block "Embroidery builder": apron color + location, logo upload (background removal, color detection), place/size within limits, hex/Pantone colors, stitch + price estimate, review and submit
- Submissions saved; logo + mockup in Shopify Files; admin Submissions list and detail

## Shipped: pay at the end of the flow
- Builder ends in Shopify checkout (draft order): aprons + embroidery per apron + one-time setup, priced on the server
- Estimate is charged as the final price (decided Oct 16)
- Order lines carry the design reference (EMB-####), location, size, colors and estimated stitches
- Admin shows checkout started / paid with the order number

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
- Proof approval: view the digital proof, approve or request changes
- Message thread per design/order between customer and the ApronWarehouse team (with email notifications both ways)
- Admin side: proof upload, status changes (received → proof sent → approved → in production → shipped), replies

## Builder improvements
- Visual zone editor in the admin (draw locations on product photos; replaces the JSON setting)
- Zone templates per apron style, assigned to products
- PDF / AI / EPS preview (server conversion with Ghostscript)
- Estimator calibration from past jobs with known stitch counts
- Text-only embroidery (name/wording with font choice), multiple locations per apron

## Operations
- Email notifications to the team on new orders/designs
- Production spec sheet PDF per order
