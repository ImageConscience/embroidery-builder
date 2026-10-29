import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [attention, problems] = await Promise.all([
    prisma.submission.count({ where: { shop: session.shop, attention: true } }).catch(() => 0),
    prisma.alert.count({ where: { shop: session.shop, resolvedAt: null } }).catch(() => 0),
  ]);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", attention, problems };
};

export default function App() {
  const { apiKey, attention, problems } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{attention ? `Design center (${attention} need reply)` : "Design center"}</s-link>
        <s-link href="/app/templates">Location templates</s-link>
        <s-link href="/app/methods">Methods</s-link>
        <s-link href="/app/settings">{problems ? `Settings (${problems} problem${problems === 1 ? "" : "s"})` : "Settings"}</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
