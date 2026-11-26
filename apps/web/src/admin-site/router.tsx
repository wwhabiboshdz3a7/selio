import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import type { OperatorCapability } from "@selio/domain";
import { RequireSession } from "../app/layout";
import AdminLayout, { RequireAdminCapability, RequireOperator } from "../app/pages/admin/AdminLayout";
import { RouteError } from "../components/RouteError";

/**
 * Routes du site Selio Admin (build « admin ») : la connexion, puis /admin et ses pages. La racine et toute
 * adresse inconnue mènent à /admin (ou à la connexion sans session). Aucune page de la vitrine ni de l'espace client.
 */
const lazy = (loader: () => Promise<{ default: React.ComponentType }>) => async () => {
  const mod = await loader();
  return { Component: mod.default };
};

/** Page de Selio Admin réservée à un droit de la matrice des opérateurs (refus clair sinon). */
const adminLazy = (capability: OperatorCapability, loader: () => Promise<{ default: React.ComponentType }>) => async () => {
  const { default: Page } = await loader();
  return { Component: () => <RequireAdminCapability capability={capability}><Page /></RequireAdminCapability> };
};

/** Chaque page a sa propre frontière d'erreur : la barre latérale reste utilisable. */
const guarded = (routes: RouteObject[]): RouteObject[] =>
  routes.map((r) => ({ ...r, ...(r.element ? {} : { errorElement: <RouteError inline /> }) }) as RouteObject);

export const adminRoutes: RouteObject[] = [
  { path: "/", element: <Navigate to="/admin" replace /> },
  { path: "/connexion", lazy: lazy(() => import("./AdminLogin")), errorElement: <RouteError /> },
  // Sections selon le rôle d'opérateur (« tech » : tout ; « business » : pilotage) : même matrice que l'API.
  {
    path: "/admin",
    element: (
      <RequireSession>
        <RequireOperator>
          <AdminLayout />
        </RequireOperator>
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: guarded([
      { index: true, lazy: adminLazy("admin.growth", () => import("../app/pages/admin/Dashboard")) },
      { path: "comptes", lazy: adminLazy("admin.accounts.read", () => import("../app/pages/admin/Accounts")) },
      { path: "comptes/:id", lazy: adminLazy("admin.accounts.read", () => import("../app/pages/admin/AccountDetail")) },
      // Offres commerciales (codes promo, bandeau) et Selio Track (usage par client, pause).
      { path: "offres", lazy: adminLazy("admin.offers", () => import("../app/pages/admin/Offers")) },
      { path: "track", lazy: adminLazy("admin.track.read", () => import("../app/pages/admin/AdminTrack")) },
      // Accès de l'équipe : les membres et rôles de l'organisation de l'opérateur.
      { path: "acces", lazy: adminLazy("admin.accounts.read", () => import("../app/pages/settings/Access")) },
      // Technique : santé, files, IA, plans et quotas ; supervision (/api/health et /api/ai/health chaque minute).
      { path: "sante", lazy: adminLazy("admin.health", () => import("../app/pages/Admin")) },
      { path: "supervision", lazy: adminLazy("admin.supervision", () => import("../app/pages/AdminSupervision")) },
      { path: "*", element: <Navigate to="/admin" replace /> },
    ]),
  },
  { path: "*", element: <Navigate to="/admin" replace /> },
];

export const router = createBrowserRouter(adminRoutes);
