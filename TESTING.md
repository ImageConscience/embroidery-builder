# Launch test checklist (dev store)

Run this top to bottom on the dev store before installing on apronwarehouse.com. Tick each line; anything that fails goes in the design center or Settings → Problems.

## 0. Before you start
- [ ] Protected customer data access is approved for the app (Partner Dashboard → App → API access). Draft-order checkout needs it.
- [ ] Latest version is deployed (Railway shows the latest commit; `shopify app deploy` run for theme extension changes).
- [ ] Online Store → Themes → Customize → App embeds: **Imprint Customizer switch** is on.
- [ ] The **Imprint Customizer** block is on the product template you're testing.
- [ ] Settings: Slack webhook saved and **Send a test message** arrives in the channel.

## 1. Admin setup
- [ ] Methods: all three show AW pricing; turn one off and confirm it disappears from the product page, then turn it back on.
- [ ] Location templates: create one DayStar and one Screen Printing template on a real apron photo (upload from computer), measure the scale, draw Chest and a pocket with limits.
- [ ] Apply both templates to 2–3 aprons by collection or tag; the products table shows **Ready** (or "No mockup photo" → upload it there).
- [ ] A product with a template but no mockup photo does **not** show the builder.

## 2. Customer flow (desktop, then phone)
- [ ] Method step shows both methods with "from" price, minimum and production time.
- [ ] Location limits work: logo can't exceed max size; >3 colors, too many stitches, below minimum quantity and wrong quantity multiple each block checkout with a clear message.
- [ ] Switch method after uploading: logo stays, location re-picks.
- [ ] Background keep/remove both look right on the mockup.
- [ ] Price on the Price step matches the Methods page math for 2 quantities (e.g. 50 and 150).
- [ ] Checkout opens with 3 lines (apron, "Method: Location (size)", setup) and the totals match.
- [ ] Phone: whole flow works by touch (drag/resize the logo, upload from the camera roll), nothing runs off the screen.

## 3. After checkout
- [ ] Pay with a test card (Bogus Gateway); design center card flips from **Not paid** to **Paid #10xx**.
- [ ] Slack got "New design EMB-…" with a link that opens the design in the admin.
- [ ] Design page: mockup, artwork, specs, colors, stitch estimate, price all present; **Download package** zip opens and the spec sheet prints.
- [ ] Customer link (from the order or the design page) opens the design page inside the store theme.

## 4. Proof loop
- [ ] Upload a proof and send it; customer page shows "Your proof is ready".
- [ ] Customer asks for changes → stage **Changes requested**, card flagged **Needs reply**, nav shows the count, Slack posts the request.
- [ ] Reply from the design page; customer sees it on their page.
- [ ] Send a second proof; customer approves → stage **Approved**, Slack posts it.
- [ ] Move to In production → Done.

## 5. Failure handling
- [ ] Temporarily break checkout (e.g. a variant that's been deleted) → customer sees "We saved your design (EMB-…)…", Settings → Problems lists it, Slack posts a warning, the nav shows "Settings (1 problem)".
- [ ] Mark it resolved; the banner and count go away.

## 6. Go-live on apronwarehouse.com
- [ ] Partner Dashboard: custom distribution for apronwarehouse.myshopify.com; install.
- [ ] Recreate (or copy) methods and location templates; add mockup photos to the launch products.
- [ ] Add the block to the live product template and turn on the app embed.
- [ ] One real low-value order end to end, then refund/cancel it.
