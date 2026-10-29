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
      { path: "plateforme", lazy: lazy(() => import("./marketing/pages/Platform")) },
      { path: "faq", lazy: lazy(() => import("./marketing/pages/Faq")) },
      { path: "contact", lazy: lazy(() => import("./marketing/pages/Contact")) },
      { path: "mentions-legales", lazy: lazy(() => import("./marketing/pages/Legal")) },
      { path: "confidentialite", lazy: lazy(() => import("./marketing/pages/Legal")) },
      { path: "conditions", lazy: lazy(() => import("./marketing/pages/Legal")) },
      { path: "connexion", lazy: lazy(() => import("./marketing/pages/Login")) },
      { path: "inscription", lazy: lazy(() => import("./marketing/pages/Register")) },
      // Liens reçus par email (jeton retiré de l'adresse avant le rendu) et demande de lien.
      { path: "mot-de-passe-oublie", lazy: lazy(() => import("./marketing/pages/ForgotPassword")) },
      { path: "mot-de-passe", lazy: lazy(() => import("./marketing/pages/ResetPassword")) },
      { path: "invitation", lazy: lazy(() => import("./marketing/pages/AcceptInvite")) },
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
      // Accueil central : Selio et ses filiales (page d'arrivée après connexion).
      { path: "espaces", lazy: lazy(() => import("./app/spaces/pages/Hub")) },
      // Le générateur d'annonces vit dans Selio Studio ; l'ancienne adresse y mène.
      { path: "studio", element: <Navigate to="/studio" replace /> },
      { path: "dressing", lazy: lazy(() => import("./app/pages/Dressing")) },
      { path: "market", element: <Navigate to="/track" replace /> },
      { path: "auto-buy", lazy: lazy(() => import("./app/pages/AutoBuy")) },
      { path: "onboarding", lazy: lazy(() => import("./app/pages/Onboarding")) },
      { path: "items", lazy: lazy(() => import("./app/pages/Items")) },
      { path: "items/new", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "items/import", lazy: lazy(() => import("./app/pages/ItemImport")) },
      { path: "items/:id", lazy: lazy(() => import("./app/pages/ItemDetail")) },
      { path: "items/:id/edit", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "selling-rules", element: <Navigate to="/app/automatisation/negociation" replace /> },
      { path: "automatisation", lazy: lazy(() => import("./app/pages/automation/AutomationHub")) },
      { path: "automatisation/favoris", lazy: lazy(() => import("./app/pages/automation/Favorites")) },
      { path: "automatisation/reponse", lazy: lazy(() => import("./app/pages/automation/AutoReply")) },
      { path: "automatisation/negociation", lazy: lazy(() => import("./app/pages/automation/Negotiation")) },
      { path: "automatisation/apres-vente", lazy: lazy(() => import("./app/pages/automation/AfterSale")) },
      { path: "automatisation/stock", lazy: lazy(() => import("./app/pages/automation/AutoStock")) },
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
      { path: "help", lazy: lazy(() => import("./app/pages/Help")) },
      { path: "settings", lazy: lazy(() => import("./app/pages/Settings")), children: [
        { index: true, element: <Navigate to="organisation" replace /> },
        { path: "organisation", lazy: lazy(() => import("./app/pages/settings/Organisation")) },
        { path: "access", lazy: lazy(() => import("./app/pages/settings/Access")) },
        { path: "members", element: <Navigate to="/app/settings/access" replace /> },
        // Les comptes Vinted ont leur propre menu (« Comptes ») : l'ancienne adresse y redirige.
        { path: "connections", element: <Navigate to="/app/accounts" replace /> },
        { path: "ai", lazy: lazy(() => import("./app/pages/settings/Ai")) },
        { path: "billing", lazy: lazy(() => import("./app/pages/settings/Billing")) },
        // Factures : liste, puis vue imprimable (window.print) d'une facture.
        { path: "invoices", lazy: lazy(() => import("./app/pages/settings/Invoices")) },
        { path: "invoices/:id", lazy: lazy(() => import("./app/pages/settings/InvoiceDetail")) },
        // « Mon utilisation » : une jauge par compteur du mois, alerte à 80 %, date de remise à zéro.
        { path: "usage", lazy: lazy(() => import("./app/pages/settings/Usage")) },
        { path: "notifications", lazy: lazy(() => import("./app/pages/settings/Notifications")) },
        { path: "security", lazy: lazy(() => import("./app/pages/settings/Security")) },
        { path: "data", lazy: lazy(() => import("./app/pages/settings/Data")) },
        { path: "status", lazy: lazy(() => import("./app/pages/settings/Status")) },
      ] },
      { path: "*", element: <Navigate to="/app" replace /> },
    ]),
  },
  // Filiales : Selio Studio, Selio Agents (aperçu), Selio Track, Selio Cloud (aperçu) et le générateur de compte (en développement).
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
    path: "/agents",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/spaces/pages/AgencyTeam")) },
      { path: "clients", lazy: lazy(() => import("./app/spaces/pages/AgencyClients")) },
      { path: "marque-blanche", lazy: lazy(() => import("./app/spaces/pages/AgencyBranding")) },
      { path: "facturation", lazy: lazy(() => import("./app/spaces/pages/AgencyBilling")) },
      { path: "*", element: <Navigate to="/agents" replace /> },
    ]),
  },
  {
    path: "/track",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/pages/Market")) },
      { path: "*", element: <Navigate to="/track" replace /> },
    ]),
  },
  {
    path: "/cloud",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      // Selio Cloud : tableau de bord, accord, comptes, journal, réglages.
      { index: true, lazy: lazy(() => import("./app/spaces/pages/CloudDashboard")) },
      { path: "accord", lazy: lazy(() => import("./app/spaces/pages/CloudConsent")) },
      { path: "comptes", lazy: lazy(() => import("./app/spaces/pages/CloudAccounts")) },
      { path: "journal", lazy: lazy(() => import("./app/spaces/pages/CloudJournal")) },
      { path: "reglages", lazy: lazy(() => import("./app/spaces/pages/CloudSettings")) },
      { path: "*", element: <Navigate to="/cloud" replace /> },
    ]),
  },
  {
    path: "/generateur",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/spaces/pages/SpaceDevelopment")) },
      { path: "*", element: <Navigate to="/generateur" replace /> },
    ]),
  },
  // Anciennes adresses : Selio Agence est devenu Selio Agents ; Selio Global (nom de l'entreprise) n'est plus un espace.
  { path: "/agence", element: <Navigate to="/agents/clients" replace /> },
  { path: "/agence/equipe", element: <Navigate to="/agents" replace /> },
  { path: "/agence/marque-blanche", element: <Navigate to="/agents/marque-blanche" replace /> },
  { path: "/agence/facturation", element: <Navigate to="/agents/facturation" replace /> },
  { path: "/agence/*", element: <Navigate to="/agents" replace /> },
  { path: "/global/*", element: <Navigate to="/app/espaces" replace /> },
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
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/pages/Admin")) },
      // Comptes et accès : aussi dans Paramètres ; ici, à portée de l'opérateur.
      { path: "acces", lazy: lazy(() => import("./app/pages/settings/Access")) },
    ]),
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
