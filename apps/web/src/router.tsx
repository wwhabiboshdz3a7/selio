import { createBrowserRouter, Navigate } from "react-router";
import { MarketingLayout } from "./marketing/layout";
import { AppLayout, RequireSession, RequireOperator } from "./app/layout";
import { RouteError } from "./components/RouteError";

const lazy = (loader: () => Promise<{ default: React.ComponentType }>) => async () => {
  const mod = await loader();
  return { Component: mod.default };
};

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MarketingLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: lazy(() => import("./marketing/pages/Home")) },
      { path: "fonctionnalites", lazy: lazy(() => import("./marketing/pages/Features")) },
      { path: "extension", lazy: lazy(() => import("./marketing/pages/Extension")) },
      { path: "assistant-ia", lazy: lazy(() => import("./marketing/pages/Assistant")) },
      { path: "tarifs", lazy: lazy(() => import("./marketing/pages/Pricing")) },
      { path: "faq", lazy: lazy(() => import("./marketing/pages/Faq")) },
      { path: "contact", lazy: lazy(() => import("./marketing/pages/Contact")) },
      { path: "mentions-legales", lazy: lazy(() => import("./marketing/pages/Legal")) },
      { path: "confidentialite", lazy: lazy(() => import("./marketing/pages/Legal")) },
      { path: "conditions", lazy: lazy(() => import("./marketing/pages/Legal")) },
      { path: "connexion", lazy: lazy(() => import("./marketing/pages/Login")) },
      { path: "inscription", lazy: lazy(() => import("./marketing/pages/Register")) },
      { path: "demo", lazy: lazy(() => import("./marketing/pages/DemoEntry")) },
    ],
  },
  {
    path: "/app",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: lazy(() => import("./app/pages/Overview")) },
      { path: "onboarding", lazy: lazy(() => import("./app/pages/Onboarding")) },
      { path: "items", lazy: lazy(() => import("./app/pages/Items")) },
      { path: "items/new", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "items/import", lazy: lazy(() => import("./app/pages/ItemImport")) },
      { path: "items/:id", lazy: lazy(() => import("./app/pages/ItemDetail")) },
      { path: "items/:id/edit", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "messages", lazy: lazy(() => import("./app/pages/Messages")) },
      { path: "messages/:id", lazy: lazy(() => import("./app/pages/Messages")) },
      { path: "customers", lazy: lazy(() => import("./app/pages/Customers")) },
      { path: "customers/:id", lazy: lazy(() => import("./app/pages/CustomerDetail")) },
      { path: "orders", lazy: lazy(() => import("./app/pages/Orders")) },
      { path: "orders/:id", lazy: lazy(() => import("./app/pages/OrderDetail")) },
      { path: "analytics", lazy: lazy(() => import("./app/pages/Analytics")) },
      { path: "automations", lazy: lazy(() => import("./app/pages/Automations")) },
      { path: "radar", lazy: lazy(() => import("./app/pages/Radar")) },
      { path: "purchase", lazy: lazy(() => import("./app/pages/Purchase")) },
      { path: "settings", lazy: lazy(() => import("./app/pages/Settings")), children: [
        { index: true, element: <Navigate to="organisation" replace /> },
        { path: "organisation", lazy: lazy(() => import("./app/pages/settings/Organisation")) },
        { path: "members", lazy: lazy(() => import("./app/pages/settings/Members")) },
        { path: "connections", lazy: lazy(() => import("./app/pages/settings/Connections")) },
        { path: "ai", lazy: lazy(() => import("./app/pages/settings/Ai")) },
        { path: "billing", lazy: lazy(() => import("./app/pages/settings/Billing")) },
        { path: "notifications", lazy: lazy(() => import("./app/pages/settings/Notifications")) },
        { path: "security", lazy: lazy(() => import("./app/pages/settings/Security")) },
        { path: "data", lazy: lazy(() => import("./app/pages/settings/Data")) },
        { path: "status", lazy: lazy(() => import("./app/pages/settings/Status")) },
      ] },
      { path: "*", element: <Navigate to="/app" replace /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <RequireSession>
        <RequireOperator>
          <AppLayout admin />
        </RequireOperator>
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: [{ index: true, lazy: lazy(() => import("./app/pages/Admin")) }],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
