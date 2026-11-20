import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ESTIMATOR } from "../lib/pricing.server";
import { listMethods } from "../lib/methods.server";
import { getVolume } from "../lib/volume.server";
import { groupVolume } from "../lib/volume";

// Builder settings for the storefront: GET https://<shop>/apps/imprint/config
// The enabled methods (pricing and rules) and the stitch estimator. Checkout is priced from the same data.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const methods = session ? await listMethods(session.shop, { enabledOnly: true }) : [];
  const volume = session ? groupVolume((await getVolume(session.shop)).rows) : [];
  return Response.json(
    {
      methods: methods.map((m) => ({
        key: m.key, name: m.name, kind: m.kind, description: m.description, minimum: m.minimum, minimumRule: m.minimumRule,
        tiers: m.tiers, setupFee: m.setupFee, includedStitches: m.includedStitches, perThousandStitches: m.perThousandStitches,
        includedColors: m.includedColors, perExtraColor: m.perExtraColor, customColorFee: m.customColorFee, maxColors: m.maxColors,
        leadTime: m.leadTime, colorNote: m.colorNote,
      })),
      estimator: ESTIMATOR,
      volume, // apron volume discount tiers; the builder picks the group matching the product
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};
