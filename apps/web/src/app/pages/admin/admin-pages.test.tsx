import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { GRANT_NO_END } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { HUB_PATH } from "../../spaces/paths";
import { adminLandingPath, adminSectionsFor, landingPath } from "../../../lib/admin";
import { appLandingPath } from "../../../lib/landing";
import type { Session } from "../../../lib/data/types";
import { RequireSession } from "../../layout";
import AdminLayout, { RequireAdminCapability, RequireOperator } from "./AdminLayout";
import AdminDashboard from "./Dashboard";
import AdminAccounts from "./Accounts";
import AdminAccountDetail from "./AccountDetail";

function renderAdmin(children: RouteObject[], initial: string) {
  const router = createMemoryRouter(
    [
      { path: "/admin", element: <RequireSession><RequireOperator><AdminLayout /></RequireOperator></RequireSession>, children },
      { path: "/app", element: <p>Espace client</p> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
  return router;
}

const ADMIN_ROUTES: RouteObject[] = [
  { index: true, element: <RequireAdminCapability capability="admin.growth"><AdminDashboard /></RequireAdminCapability> },
  { path: "comptes", element: <RequireAdminCapability capability="admin.accounts.read"><AdminAccounts /></RequireAdminCapability> },
  { path: "comptes/:id", element: <RequireAdminCapability capability="admin.accounts.read"><AdminAccountDetail /></RequireAdminCapability> },
  { path: "sante", element: <RequireAdminCapability capability="admin.health"><p>Page santé</p></RequireAdminCapability> },
];

beforeEach(async () => {
  localStorage.clear();
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  queryClient.clear();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await getDemoClient().previewOperatorRole?.(null).catch(() => undefined);
  localStorage.clear();
});

const session = (operatorRole: "tech" | "business" | null, mode: "demo" | "connected" = "connected") => ({ mode, user: { isOperator: operatorRole !== null, operatorRole } }) as unknown as Session;

describe("Selio Admin : arrivée et accès", () => {
  it("à la connexion, un opérateur arrive sur /admin ; un client sur l'accueil des espaces ; la démo reste une vitrine de l'espace client", () => {
    expect(landingPath(session("tech"))).toBe("/admin");
    expect(landingPath(session("business"))).toBe("/admin");
    expect(landingPath(session(null))).toBe(HUB_PATH);
    expect(landingPath(session("tech", "demo"))).toBe(HUB_PATH);
    // Retour vers la page demandée : l'administration pour un opérateur seulement.
    expect(landingPath(session("business"), "/admin/comptes")).toBe("/admin/comptes");
    expect(landingPath(session(null), "/admin/comptes")).toBe(HUB_PATH);
    expect(landingPath(session(null), "/app/items")).toBe("/app/items");
    expect(landingPath(session("tech"), "https://ailleurs.exemple/admin")).toBe("/admin");
  });

  it("deux sites : le site public mène tout le monde à l'espace client (jamais /admin), le site Selio Admin à l'administration", () => {
    expect(appLandingPath()).toBe(HUB_PATH);
    expect(appLandingPath("/app/items")).toBe("/app/items");
    expect(appLandingPath("/admin/comptes")).toBe(HUB_PATH);
    expect(appLandingPath("https://ailleurs.exemple/app")).toBe(HUB_PATH);
    expect(adminLandingPath()).toBe("/admin");
    expect(adminLandingPath("/admin/comptes?q=elias")).toBe("/admin/comptes?q=elias");
    expect(adminLandingPath("/app/items")).toBe("/admin");
    expect(adminLandingPath("//ailleurs.exemple/admin")).toBe("/admin");
  });

  it("un non-opérateur qui ouvre /admin voit un refus clair (le site Selio Admin n'a pas d'espace client)", async () => {
    const client = getDemoClient();
    const real = (await client.getSession())!;
    vi.spyOn(client, "getSession").mockResolvedValue({ ...real, user: { ...real.user, isOperator: false, operatorRole: null } });
    renderAdmin(ADMIN_ROUTES, "/admin");
    expect(await screen.findByTestId("admin-not-operator")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Accès réservé à l'équipe Selio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
  });

  it("menus selon le rôle : « tech » voit tout, « business » le pilotage seulement (même matrice que l'API)", () => {
    const tech = adminSectionsFor("tech").map((s) => s.label);
    const business = adminSectionsFor("business").map((s) => s.label);
    expect(tech).toEqual(["Tableau de bord", "Comptes", "Offres", "Track", "Accès de l'équipe", "Santé et plans", "Supervision"]);
    expect(business).toEqual(["Tableau de bord", "Comptes", "Offres", "Track", "Accès de l'équipe"]);
    expect(adminSectionsFor(null)).toEqual([]);
  });
});

describe("Selio Admin : mise en page", () => {
  it("opératrice technique (Marie) : titre, badge « Technique », sections techniques, aucun lien vers l'espace client, aucun bandeau d'essai", async () => {
    renderAdmin(ADMIN_ROUTES, "/admin");
    expect(await screen.findByRole("heading", { name: "Tableau de bord" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Sections de l'administration" });
    expect(within(nav).getByRole("link", { name: "Santé et plans" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Supervision" })).toBeTruthy();
    // Site séparé : sans VITE_PUBLIC_SITE_URL, aucun lien vers le site public ni vers /app.
    expect(within(nav).queryByRole("link", { name: /espace client|site Selio/ })).toBeNull();
    expect(screen.getAllByTestId("operator-role-badge")[0]!.textContent).toContain("Technique");
    expect(screen.queryByTestId("trial-card-banner")).toBeNull();
    // Chiffres du tableau de bord : compte de la démo + six comptes d'exemple.
    expect(await screen.findByText("Comptes inscrits")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("rôle « business » : sections techniques masquées, page technique refusée avec un message clair", async () => {
    await getDemoClient().previewOperatorRole!("business");
    renderAdmin(ADMIN_ROUTES, "/admin/sante");
    expect(await screen.findByTestId("admin-forbidden")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Page réservée à l'opérateur technique" })).toBeTruthy();
    expect(screen.queryByText("Page santé")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Sections de l'administration" });
    expect(within(nav).queryByRole("link", { name: "Santé et plans" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Supervision" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Comptes" })).toBeTruthy();
    expect(screen.getAllByTestId("operator-role-badge")[0]!.textContent).toContain("Business");
    // Le client démo refuse aussi les données techniques (même matrice que l'API).
    await expect(getDemoClient().getAdminOverview()).rejects.toMatchObject({ status: 403 });
    await expect(getDemoClient().getAdminGrowth()).resolves.toBeTruthy();
  });
});

describe("Selio Admin : comptes (démonstration)", () => {
  it("liste cherchable et filtrable par qualification", async () => {
    renderAdmin(ADMIN_ROUTES, "/admin/comptes?qualification=bloque");
    expect(await screen.findByRole("link", { name: "Revente Express (exemple)" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Atelier Lune (exemple)" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Qualification"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "lune" } });
    expect(await screen.findByRole("link", { name: "Atelier Lune (exemple)" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("link", { name: "Revente Express (exemple)" })).toBeNull());
  });

  it("compte d'une opératrice : « Équipe Selio » et Agence offert sans fin en un clic → plus d'essai, historique à jour", async () => {
    const client = getDemoClient();
    const orgId = (await client.getSession())!.org.id;
    expect((await client.getSubscription()).status).toBe("trialing");
    renderAdmin(ADMIN_ROUTES, `/admin/comptes/${orgId}`);
    const button = await screen.findByRole("button", { name: "Qualifier « Équipe Selio »" });
    fireEvent.click(button);
    await waitFor(async () => expect((await client.getSubscription()).grantedUntil).toBe(GRANT_NO_END));
    const sub = await client.getSubscription();
    expect(sub).toMatchObject({ plan: "agence", status: "active", provider: "none" });
    const history = await screen.findByRole("list", { name: "Historique du compte" });
    await waitFor(() => expect(within(history).getAllByText("Accès offert").length).toBeGreaterThan(0));
    expect(within(history).getByText("Qualification modifiée")).toBeTruthy();
    // Ces actions internes n'apparaissent pas dans le journal d'audit du client.
    expect((await client.listAuditLogs()).some((a) => a.action.startsWith("admin.access_") || a.action.startsWith("admin.account_"))).toBe(false);
  });

  it("qualification avec note, prolongation d'essai, blocage confirmé ; accès offert sans fin refusé hors équipe", async () => {
    const client = getDemoClient();
    renderAdmin(ADMIN_ROUTES, "/admin/comptes/org-exemple-essai");
    expect(await screen.findByRole("heading", { name: "Vintage Sœurs (exemple)" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Qualification"), { target: { value: "beta" } });
    fireEvent.change(screen.getByLabelText("Note interne"), { target: { value: "Rencontrée au salon." } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(async () => expect((await client.adminGetAccount("org-exemple-essai")).qualification).toBe("beta"));
    expect((await client.adminGetAccount("org-exemple-essai")).qualificationNote).toBe("Rencontrée au salon.");
    const before = (await client.adminGetAccount("org-exemple-essai")).currentPeriodEnd!;
    fireEvent.change(screen.getByLabelText("Nombre de jours"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Prolonger" }));
    await waitFor(async () => expect(new Date((await client.adminGetAccount("org-exemple-essai")).currentPeriodEnd!).getTime() - new Date(before).getTime()).toBe(10 * 86_400_000));
    await expect(client.adminExtendTrial("org-exemple-essai", 91)).rejects.toMatchObject({ status: 400 });
    await expect(client.adminGrantAccess("org-exemple-essai", { plan: "agence", until: null })).rejects.toMatchObject({ status: 400 });
    // Blocage : confirmation demandée.
    fireEvent.change(await screen.findByLabelText("Qualification"), { target: { value: "bloque" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bloquer le compte" }));
    await waitFor(async () => expect((await client.adminGetAccount("org-exemple-essai")).qualification).toBe("bloque"));
    const growth = await client.getAdminGrowth();
    expect(growth.accounts.blocked).toBe(2);
  });

  it("accès offert daté puis retiré ; refusé sur un compte qui paie par carte", async () => {
    const client = getDemoClient();
    const until = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const granted = await client.adminGrantAccess("org-exemple-test", { plan: "pro", until });
    expect(granted).toMatchObject({ plan: "pro", status: "active", grantedUntil: until });
    expect(granted.history[0]!.action).toBe("admin.access_granted");
    const revoked = await client.adminRevokeAccess("org-exemple-test");
    expect(revoked).toMatchObject({ plan: "free", status: "canceled", grantedUntil: null });
    await expect(client.adminGrantAccess("org-exemple-starter", { plan: "pro", until })).rejects.toMatchObject({ status: 409 });
  });
});
