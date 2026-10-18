import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { MarketingLayout } from "./marketing/layout";
import { AppLayout, RequireSession, RequireOperator } from "./app/layout";
import { RouteError } from "./components/RouteError";

const lazy = (loader: () => Promise<{ default: React.ComponentType }>) => async () => {
  const mod = await loader();
  return { Component: mod.default };
};

/**
 * Chaque page a sa propre frontière d'erreur : une page en échec s'affiche dans
 * la mise en page (menu, en-tête), le reste de l'application reste utilisable.
 */
const guarded = (routes: RouteObject[]): RouteObject[] =>
  routes.map((r) => ({ ...r, ...(r.element ? {} : { errorElement: <RouteError inline /> }), ...(r.children ? { children: guarded(r.children) } : {}) }) as RouteObject);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MarketingLayout />,
    errorElement: <RouteError />,
    children: guarded([
      // Le moteur de la constellation (et anime.js) se charge en parallèle de la page.
      { index: true, lazy: lazy(() => {
        import("./marketing/constellation/engine").catch(() => undefined);
        return import("./marketing/pages/Home");
      }) },
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
    ]),
  },
  {
    path: "/app",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/pages/Overview")) },
      // Accueil central : les quatre espaces Selio (page d'arrivée après connexion).
      { path: "espaces", lazy: lazy(() => import("./app/spaces/pages/Hub")) },
      // Le générateur d'annonces vit dans Selio Studio ; l'ancienne adresse y mène.
      { path: "studio", element: <Navigate to="/studio" replace /> },
      { path: "dressing", lazy: lazy(() => import("./app/pages/Dressing")) },
      { path: "market", lazy: lazy(() => import("./app/pages/Market")) },
      { path: "auto-buy", lazy: lazy(() => import("./app/pages/AutoBuy")) },
      { path: "onboarding", lazy: lazy(() => import("./app/pages/Onboarding")) },
      { path: "items", lazy: lazy(() => import("./app/pages/Items")) },
      { path: "items/new", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "items/import", lazy: lazy(() => import("./app/pages/ItemImport")) },
      { path: "items/:id", lazy: lazy(() => import("./app/pages/ItemDetail")) },
      { path: "items/:id/edit", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "selling-rules", lazy: lazy(() => import("./app/pages/SellingRules")) },
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
      { path: "accounts", lazy: lazy(() => import("./app/pages/Accounts")) },
      { path: "settings", lazy: lazy(() => import("./app/pages/Settings")), children: [
        { index: true, element: <Navigate to="organisation" replace /> },
        { path: "organisation", lazy: lazy(() => import("./app/pages/settings/Organisation")) },
        { path: "access", lazy: lazy(() => import("./app/pages/settings/Access")) },
        { path: "members", element: <Navigate to="/app/settings/access" replace /> },
        // Les comptes Vinted ont leur propre menu (« Comptes ») : l'ancienne adresse y redirige.
        { path: "connections", element: <Navigate to="/app/accounts" replace /> },
        { path: "ai", lazy: lazy(() => import("./app/pages/settings/Ai")) },
        { path: "billing", lazy: lazy(() => import("./app/pages/settings/Billing")) },
        { path: "notifications", lazy: lazy(() => import("./app/pages/settings/Notifications")) },
        { path: "security", lazy: lazy(() => import("./app/pages/settings/Security")) },
        { path: "data", lazy: lazy(() => import("./app/pages/settings/Data")) },
        { path: "status", lazy: lazy(() => import("./app/pages/settings/Status")) },
      ] },
      { path: "*", element: <Navigate to="/app" replace /> },
    ]),
  },
  // Espaces Selio Studio, Agence (aperçu) et Global (en préparation) : même mise en page, menu propre.
  {
    path: "/studio",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/pages/Studio")) },
      { path: "annonces", lazy: lazy(() => import("./app/spaces/pages/StudioGenerated")) },
      { path: "performances", lazy: lazy(() => import("./app/spaces/pages/StudioInsights")) },
      { path: "*", element: <Navigate to="/studio" replace /> },
    ]),
  },
  {
    path: "/agence",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/spaces/pages/AgencyClients")) },
      { path: "marque-blanche", lazy: lazy(() => import("./app/spaces/pages/AgencyBranding")) },
      { path: "equipe", lazy: lazy(() => import("./app/spaces/pages/AgencyTeam")) },
      { path: "facturation", lazy: lazy(() => import("./app/spaces/pages/AgencyBilling")) },
      { path: "*", element: <Navigate to="/agence" replace /> },
    ]),
  },
  {
    path: "/global",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/spaces/pages/GlobalMarkets")) },
      { path: "tailles", lazy: lazy(() => import("./app/spaces/pages/GlobalSizes")) },
      { path: "places-de-marche", lazy: lazy(() => import("./app/spaces/pages/GlobalMarketplaces")) },
      { path: "*", element: <Navigate to="/global" replace /> },
    ]),
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
    children: guarded([{ index: true, lazy: lazy(() => import("./app/pages/Admin")) }]),
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
