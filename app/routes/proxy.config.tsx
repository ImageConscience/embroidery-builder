import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ESTIMATOR, PRICING } from "../lib/pricing.server";

// Builder settings for the storefront: GET https://<shop>/apps/embroidery/config
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return Response.json(
    { pricing: PRICING, estimator: ESTIMATOR },
    { headers: { "Cache-Control": "no-store" } },
  );
};
