import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { MarketingLayout } from "./marketing/layout";
import { AppLayout, RequireSession } from "./app/layout";
import { RouteError } from "./components/RouteError";
import { RequireFinances } from "./app/components/finance";

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
      // Politique de confidentialité de l'extension (adresse donnée au Chrome Web Store).
      { path: "extension/confidentialite", lazy: lazy(() => import("./marketing/pages/ExtensionPrivacy")) },
      // Une page par filiale, sous /produits (les adresses /studio, /track, /cloud… sont celles de l'application).
      { path: "produits", element: <Navigate to="/plateforme" replace /> },
      { path: "produits/:slug", lazy: lazy(() => import("./marketing/pages/Product")) },
      // Comparatifs : textes d'Elias attendus, non référencés tant que COMPARISON_READY est faux (marketing/seo.ts).
      { path: "selio-ou-bleam", lazy: lazy(() => import("./marketing/pages/SelioOrBleam")) },
      { path: "alternative-bleam", lazy: lazy(() => import("./marketing/pages/AlternativeBleam")) },
      // Pages d'atterrissage publicitaires : une intention de recherche chacune (marketing/landings.ts).
      { path: "logiciel-vinted", lazy: lazy(() => import("./marketing/pages/Landing")) },
      { path: "negociation-automatique-vinted", lazy: lazy(() => import("./marketing/pages/Landing")) },
      { path: "annonce-vinted-ia", lazy: lazy(() => import("./marketing/pages/Landing")) },
      { path: "prix-revente-vinted", lazy: lazy(() => import("./marketing/pages/Landing")) },
      { path: "bot-achat-vinted", lazy: lazy(() => import("./marketing/pages/Landing")) },
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
      // Démonstration : seulement dans un build sans API (tests, vidéos) ; en production, l'adresse mène à l'essai gratuit.
      __SELIO_DEMO__ ? { path: "demo", lazy: lazy(() => import("./marketing/pages/DemoEntry")) } : { path: "demo", element: <Navigate to="/inscription" replace /> },
      // Adresse inconnue (dont /admin : Selio Admin vit sur un site séparé, voir src/admin-site) : page 404 de la vitrine.
      { path: "*", lazy: lazy(() => import("./marketing/pages/NotFound")) },
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
      // Lots intelligents : propositions de lots (même acheteur, même marque et taille, articles anciens).
      { path: "items/lots", lazy: lazy(() => import("./app/pages/Bundles")) },
      // Contributeur photos : liste des articles à photographier et ajout de photos seulement (« items.photos.write »).
      { path: "items/photos", lazy: lazy(() => import("./app/pages/ItemPhotos")) },
      { path: "items/:id/photos", lazy: lazy(() => import("./app/pages/ItemPhotos").then((m) => ({ default: m.ItemPhotosDetail }))) },
      { path: "items/:id", lazy: lazy(() => import("./app/pages/ItemDetail")) },
      { path: "items/:id/edit", lazy: lazy(() => import("./app/pages/ItemForm")) },
      { path: "selling-rules", element: <Navigate to="/app/automatisation/negociation" replace /> },
      { path: "automatisation", lazy: lazy(() => import("./app/pages/automation/AutomationHub")) },
      { path: "automatisation/favoris", lazy: lazy(() => import("./app/pages/automation/Favorites")) },
      { path: "automatisation/reponse", lazy: lazy(() => import("./app/pages/automation/AutoReply")) },
      { path: "automatisation/negociation", lazy: lazy(() => import("./app/pages/automation/Negotiation")) },
      { path: "automatisation/apres-vente", lazy: lazy(() => import("./app/pages/automation/AfterSale")) },
      { path: "automatisation/stock", lazy: lazy(() => import("./app/pages/automation/AutoStock")) },
      // État et règles des automatisations sans page de réglages à elles (anciennement /bot/relance, /bot/republication).
      { path: "automatisation/relances", lazy: lazy(() => import("./app/pages/automation/AutomationDetail").then((m) => ({ default: m.FollowUpPage }))) },
      { path: "automatisation/republication", lazy: lazy(() => import("./app/pages/automation/AutomationDetail").then((m) => ({ default: m.RepublishPage }))) },
      { path: "messages", lazy: lazy(() => import("./app/pages/Messages")) },
      { path: "messages/:id", lazy: lazy(() => import("./app/pages/Messages")) },
      { path: "customers", lazy: lazy(() => import("./app/pages/Customers")) },
      { path: "customers/:id", lazy: lazy(() => import("./app/pages/CustomerDetail")) },
      { path: "orders", lazy: lazy(() => import("./app/pages/Orders")) },
      { path: "orders/:id", lazy: lazy(() => import("./app/pages/OrderDetail")) },
      { path: "analytics", lazy: lazy(() => import("./app/pages/Analytics")) },
      // Journal d'activité de Selio Manager : ce que Selio, Studio, Selio Bot et l'équipe ont fait.
      { path: "journal", lazy: lazy(() => import("./app/pages/Journal")) },
      { path: "automations", lazy: lazy(() => import("./app/pages/Automations")) },
      // Selio Bot (recherche et achat) : ces adresses historiques restent valides (alertes sur le téléphone, journal) et
      // appartiennent à l'espace Bot (spaces/paths.ts) : menu et teinte de Selio Bot.
      { path: "radar", lazy: lazy(() => import("./app/pages/Radar")) },
      // Page d'une affaire (« 1 clic »), ouverte depuis une alerte sur le téléphone ; achat à valider (3-D Secure).
      { path: "radar/affaires/:id", lazy: lazy(() => import("./app/pages/RadarDeal")) },
      { path: "radar/achats/:id", lazy: lazy(() => import("./app/pages/AutoBuy")) },
      { path: "purchase", lazy: lazy(() => import("./app/pages/Purchase")) },
      { path: "accounts", lazy: lazy(() => import("./app/pages/Accounts")) },
      { path: "help", lazy: lazy(() => import("./app/pages/Help")) },
      // Alerte « Radar en pause » : le compte Achat se reprend dans l'espace Cloud.
      { path: "cloud", element: <Navigate to="/cloud/comptes" replace /> },
      { path: "settings", lazy: lazy(() => import("./app/pages/Settings")), children: [
        // Organisation, ou Apparence pour la vue réduite du contributeur photos.
        { index: true, lazy: lazy(() => import("./app/pages/Settings").then((m) => ({ default: m.SettingsHome }))) },
        { path: "organisation", lazy: lazy(() => import("./app/pages/settings/Organisation")) },
        { path: "access", lazy: lazy(() => import("./app/pages/settings/Access")) },
        { path: "members", element: <Navigate to="/app/settings/access" replace /> },
        // Les comptes Vinted ont leur propre menu (« Comptes ») : l'ancienne adresse y redirige.
        { path: "connections", element: <Navigate to="/app/accounts" replace /> },
        { path: "ai", lazy: lazy(() => import("./app/pages/settings/Ai")) },
        // Thème (clair, sombre, système).
        { path: "apparence", lazy: lazy(() => import("./app/pages/settings/Appearance")) },
        // Parrainage : masqué tant que REFERRAL_ENABLED est faux (proposition dans la démonstration).
        { path: "parrainage", lazy: lazy(() => import("./app/pages/settings/Referral")) },
        // Abonnement et factures : finances, réservées aux rôles qui les voient (pas l'exécuteur).
        { element: <RequireFinances />, children: [
          { path: "billing", lazy: lazy(() => import("./app/pages/settings/Billing")) },
          // Factures : liste, puis vue imprimable (window.print) d'une facture.
          { path: "invoices", lazy: lazy(() => import("./app/pages/settings/Invoices")) },
          { path: "invoices/:id", lazy: lazy(() => import("./app/pages/settings/InvoiceDetail")) },
        ] },
        // « Mon utilisation » : une jauge par compteur du mois, alerte à 80 %, date de remise à zéro.
        { path: "usage", lazy: lazy(() => import("./app/pages/settings/Usage")) },
        { path: "notifications", lazy: lazy(() => import("./app/pages/settings/Notifications")) },
        { path: "security", lazy: lazy(() => import("./app/pages/settings/Security")) },
        { path: "data", lazy: lazy(() => import("./app/pages/settings/Data")) },
        // Migration depuis un autre outil : texte collé, captures ou fichier RGPD ; jamais de connexion à leur service.
        { path: "migration", lazy: lazy(() => import("./app/pages/settings/Migration")) },
        { path: "status", lazy: lazy(() => import("./app/pages/settings/Status")) },
      ] },
      { path: "*", element: <Navigate to="/app" replace /> },
    ]),
  },
  // Filiales : Selio Studio, Selio Track, Selio Bot et Selio Compte ; Selio Cloud et Selio Agent (aperçu) sont
  // intégrés à Selio Manager (menu du Manager), avec leurs propres adresses.
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
      // Photos portées : file de nuit, quota du mois, aucun fournisseur choisi (dit à l'écran).
      { path: "photos-portees", lazy: lazy(() => import("./app/spaces/pages/StudioWornPhotos")) },
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
      // Selio Track (Pro et Agence) : statistiques seulement ; page d'explication pour les autres offres.
      { index: true, lazy: lazy(() => import("./app/pages/track/Dashboard")) },
      { path: "filtres", lazy: lazy(() => import("./app/pages/track/Filters")) },
      { path: "filtres/:id", lazy: lazy(() => import("./app/pages/track/FilterDetail")) },
      { path: "niches", lazy: lazy(() => import("./app/pages/track/Niches")) },
      { path: "photo", lazy: lazy(() => import("./app/pages/track/Photo")) },
      { path: "ventes", lazy: lazy(() => import("./app/pages/track/Sales")) },
      { path: "vendeurs", lazy: lazy(() => import("./app/pages/track/Sellers")) },
      { path: "*", element: <Navigate to="/track" replace /> },
    ]),
  },
  {
    // Selio Bot : recherche et achat d'articles. Les automatisations du compte (négociation, relances…) sont dans
    // Selio Manager › Automatisation : leurs anciennes adresses /bot/negociation… y redirigent.
    path: "/bot",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/pages/bot/BotHome")) },
      // Achat automatique (deux verrous du serveur) et achat rapide validé en 1 clic, côte à côte.
      { path: "achat-auto", lazy: lazy(() => import("./app/pages/bot/BotAutoBuy")) },
      { path: ":slug", lazy: lazy(() => import("./app/pages/automation/AutomationDetail").then((m) => ({ default: m.LegacyBotRedirect }))) },
      { path: "*", element: <Navigate to="/bot" replace /> },
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
    // Selio Compte : checklist et textes à copier, sans aucune action à la place du client.
    path: "/comptes",
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: lazy(() => import("./app/spaces/pages/Comptes")) },
      { path: "*", element: <Navigate to="/comptes" replace /> },
    ]),
  },
  // L'ancien « générateur de compte » est devenu Selio Compte.
  { path: "/generateur", element: <Navigate to="/comptes" replace /> },
  { path: "/generateur/*", element: <Navigate to="/comptes" replace /> },
  // Anciennes adresses : Selio Agence est devenu Selio Agent ; Selio Global (nom de l'entreprise) n'est plus un espace.
  { path: "/agence", element: <Navigate to="/agents/clients" replace /> },
  { path: "/agence/equipe", element: <Navigate to="/agents" replace /> },
  { path: "/agence/marque-blanche", element: <Navigate to="/agents/marque-blanche" replace /> },
  { path: "/agence/facturation", element: <Navigate to="/agents/facturation" replace /> },
  { path: "/agence/*", element: <Navigate to="/agents" replace /> },
  { path: "/global/*", element: <Navigate to="/app/espaces" replace /> },
]);
