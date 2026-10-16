import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Storefront check through the app proxy: https://<shop>/apps/embroidery/ping
// authenticate.public.appProxy verifies Shopify's signature on the request.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  return Response.json({ ok: true, shop: session?.shop ?? null });
};
