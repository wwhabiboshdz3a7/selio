import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { ROLE_LABELS } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../lib/data/provider";
import { glassStorageKey } from "../lib/glass";
import { COMPTES_NOTICE, COMPTES_STEP_IDS } from "../lib/comptes";
import { AppLayout, RequireSession } from "./layout";
import Access from "./pages/settings/Access";
import Appearance from "./pages/settings/Appearance";
import Referral from "./pages/settings/Referral";
import Settings from "./pages/Settings";
import Items from "./pages/Items";
import Overview from "./pages/Overview";
import AdminSupervision from "./pages/AdminSupervision";
import ItemPhotos from "./pages/ItemPhotos";
import Comptes from "./spaces/pages/Comptes";

const USER_ID = "user-demo";

function renderRoutes(children: RouteObject[], initial: string) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <RequireSession><AppLayout /></RequireSession>, children },
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
  await getDemoClient().previewRole!(null).catch(() => undefined);
  localStorage.clear();
});

describe("Paramètres › Comptes et accès", () => {
  it("matrice à cinq rôles, explication des finances, invitation avec les nouveaux rôles (jamais titulaire)", async () => {
    renderRoutes([{ path: "app/settings/access", element: <Access /> }], "/app/settings/access");
    const matrix = (await screen.findByRole("heading", { name: "Qui peut faire quoi" })).closest(".card") as HTMLElement;
    const headers = within(matrix).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Action", "Titulaire", "Administrateur", "Exécuteur", "Contributeur photos", "Lecture seule"]);
    // Ligne « Voir les finances » : titulaire, administrateur, lecture seule ; ni exécuteur ni contributeur photos.
    const finances = within(matrix).getByRole("row", { name: /Voir les finances/ });
    const cells = within(finances).getAllByRole("cell").slice(1).map((c) => (within(c).queryByLabelText("Autorisé") ? "oui" : "non"));
    expect(cells).toEqual(["oui", "oui", "non", "non", "oui"]);
    // Contributeur photos : photos et générateur seulement.
    const photos = within(matrix).getByRole("row", { name: /Ajouter des photos aux articles/ });
    expect(within(within(photos).getAllByRole("cell")[4]!).getByLabelText("Autorisé")).toBeTruthy();
    const send = within(matrix).getByRole("row", { name: /Envoyer des messages aux acheteurs/ });
    expect(within(within(send).getAllByRole("cell")[4]!).getByLabelText("Non autorisé")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "L'exécuteur ne voit pas les finances" })).toBeTruthy();
    // Rôles latéraux : pas de « Tout ce que fait … » pour le contributeur photos ni la lecture seule.
    expect(screen.getByText("Tout ce que fait « Exécuteur », et :")).toBeTruthy();
    expect(screen.queryByText("Tout ce que fait « Lecture seule », et :")).toBeNull();
    const invite = screen.getByRole("heading", { name: "Inviter un membre" }).closest(".card") as HTMLElement;
    const options = within(within(invite).getByLabelText("Rôle")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Administrateur", "Exécuteur", "Contributeur photos", "Lecture seule"]);
  });
});

describe("masquage des finances pour l'exécuteur (dans l'interface)", () => {
  it("titulaire : montants visibles, aucun masque", async () => {
    renderRoutes([{ path: "app/items", element: <Items /> }], "/app/items");
    await screen.findByRole("heading", { name: "Articles et stock" });
    await waitFor(() => expect(document.querySelectorAll("[data-finance-masked]").length).toBe(0));
    expect(screen.getByRole("button", { name: /Exporter CSV/ })).toBeTruthy();
  });

  it("exécuteur : prix d'achat et marges masqués, export retiré, chiffre d'affaires masqué sur la vue d'ensemble", async () => {
    await getDemoClient().previewRole!("operator");
    queryClient.clear();
    renderRoutes([{ path: "app/items", element: <Items /> }, { path: "app", element: <Overview /> }], "/app/items");
    await screen.findByRole("heading", { name: "Articles et stock" });
    await waitFor(() => expect(document.querySelectorAll("[data-finance-masked]").length).toBeGreaterThan(0));
    expect(screen.getByTestId("finance-masked-note").textContent).toMatch(/exécuteur/);
    expect(screen.queryByRole("button", { name: /Exporter CSV/ })).toBeNull();
    expect(screen.queryByRole("option", { name: "Marge projetée" })).toBeNull();
    expect(screen.getByTestId("role-preview-banner").textContent).toContain(ROLE_LABELS.operator);
    cleanup();
    renderRoutes([{ path: "app", element: <Overview /> }], "/app");
    await screen.findByRole("heading", { name: /Bonjour/ });
    const ca = await screen.findByText("Chiffre d'affaires");
    expect(ca.parentElement!.querySelector("[data-finance-masked]")).not.toBeNull();
    expect(screen.queryByText("Ventes et marge brute")).toBeNull();
  });
});

describe("vue réduite du contributeur photos", () => {
  it("menu restreint, accueils redirigés vers les articles à photographier, autres pages refusées", async () => {
    await getDemoClient().previewRole!("photographer");
    queryClient.clear();
    const router = renderRoutes([
      { path: "app", element: <p>page-vue-ensemble</p> },
      { path: "app/items/photos", element: <ItemPhotos /> },
      { path: "app/messages", element: <p>page-messagerie</p> },
    ], "/app");
    expect(await screen.findByRole("heading", { name: "Articles à photographier" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/app/items/photos");
    const nav = screen.getAllByRole("navigation", { name: "Navigation de l'application" })[0]!;
    const links = within(nav).getAllByRole("link").map((a) => a.textContent?.trim());
    // Le menu de la vue réduite (la démo est aussi opératrice Selio : sa section « Opérateur » reste à part).
    expect(links.slice(0, 5)).toEqual(["Articles à photographier", "Générateur d'annonces", "Annonces générées", "Aide", "Paramètres"]);
    for (const hidden of ["Messagerie", "Commandes", "Analyses", "Vue d'ensemble", "Bonnes affaires"]) expect(links).not.toContain(hidden);
    expect(screen.queryByText("page-vue-ensemble")).toBeNull();
    await act(() => router.navigate("/app/messages"));
    expect(await screen.findByTestId("reduced-view-blocked")).toBeTruthy();
    expect(screen.queryByText("page-messagerie")).toBeNull();
  });
});

describe("Paramètres › Parrainage", () => {
  it("démonstration : code, lien à copier, statut des filleules, offre marquée « Proposition »", async () => {
    renderRoutes([{ path: "app/settings", element: <Settings />, children: [{ path: "parrainage", element: <Referral /> }] }], "/app/settings/parrainage");
    expect(await screen.findByTestId("referral-proposal")).toBeTruthy();
    const code = (screen.getByLabelText("Votre code") as HTMLInputElement).value;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect((screen.getByLabelText("Lien d'inscription à partager") as HTMLInputElement).value).toContain(`/inscription?parrain=${code}`);
    expect(within(screen.getByRole("list", { name: "Filleules par statut" })).getAllByRole("listitem")).toHaveLength(4);
    const menu = screen.getByRole("navigation", { name: "Sections des paramètres" });
    expect(await within(menu).findByRole("link", { name: "Parrainage" })).toBeTruthy();
    expect(within(menu).getByRole("link", { name: "Apparence" })).toBeTruthy();
  });

  it("parrainage fermé (REFERRAL_ENABLED=false) : section absente du menu, page masquée", async () => {
    const client = getDemoClient();
    vi.spyOn(client, "getReferral").mockResolvedValue({ enabled: false, proposal: false, code: null, shareUrl: null, referred: { pending: 0, qualified: 0, credited: 0, refused: 0 }, creditsAvailable: 0, creditsConsumed: 0, referredBy: null });
    const router = renderRoutes([{ path: "app/settings", element: <Settings />, children: [{ index: true, element: <p>page-index</p> }, { path: "parrainage", element: <Referral /> }] }], "/app/settings/parrainage");
    expect(await screen.findByText("page-index")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/app/settings");
    expect(within(screen.getByRole("navigation", { name: "Sections des paramètres" })).queryByRole("link", { name: "Parrainage" })).toBeNull();
  });
});

describe("Selio Comptes", () => {
  it("bandeau sans action à la place du client, checklist cochable et mémorisée, textes à copier", async () => {
    renderRoutes([{ path: "comptes", element: <Comptes /> }], "/comptes");
    expect((await screen.findByTestId("comptes-notice")).textContent).toBe(COMPTES_NOTICE);
    expect(screen.getByTestId("comptes-progress").textContent).toBe(`0 / ${COMPTES_STEP_IDS.length} étapes`);
    const box = screen.getByRole("checkbox", { name: /Confirmer l'adresse email/ });
    fireEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("comptes-progress").textContent).toBe(`1 / ${COMPTES_STEP_IDS.length} étapes`);
    const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).find((k) => k.startsWith("selio.comptes."));
    const saved = JSON.parse(localStorage.getItem(key ?? "") ?? "{}") as { done?: string[] };
    expect(saved.done ?? []).toContain("ouverture.email");
    // Les textes suivent les réponses.
    fireEvent.change(screen.getByLabelText("Délai d'expédition (jours ouvrés)"), { target: { value: "4" } });
    expect((screen.getByLabelText("Règles d'envoi") as HTMLTextAreaElement).value).toContain("Expédition sous 4 jours ouvrés");
    expect(screen.getByRole("button", { name: "Copier « Présentation »" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Réponses types" })).getAllByRole("listitem").length).toBe(5);
  });
});

describe("essai « verre liquide »", () => {
  it("désactivé par défaut : aucune surface de verre ni dock dans le DOM (non-régression)", async () => {
    renderRoutes([{ path: "app/settings/apparence", element: <Appearance /> }], "/app/settings/apparence");
    const toggle = await screen.findByRole("switch", { name: /Essai : verre liquide/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("mobile-dock")).toBeNull();
    expect(document.querySelectorAll(".glass-surface, [data-glass]").length).toBe(0);
  });

  it("activé : dock (4 entrées + « Générer ») construit sur GlassSurface, mémorisé pour l'utilisateur ; désactivé : plus rien", async () => {
    renderRoutes([{ path: "app/settings/apparence", element: <Appearance /> }], "/app/settings/apparence");
    fireEvent.click(await screen.findByRole("switch", { name: /Essai : verre liquide/ }));
    const dock = await screen.findByTestId("mobile-dock");
    expect(dock.classList.contains("glass-surface")).toBe(true);
    expect(dock.getAttribute("data-glass")).toMatch(/^(glass|opaque)$/);
    expect(dock.className).toContain("fixed");
    expect(dock.className).toContain("md:hidden");
    expect(dock.className).toContain("bottom-[calc(env(safe-area-inset-bottom)+12px)]");
    const height = Number(/\bh-\[(\d+)px\]/.exec(dock.className)?.[1]);
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThanOrEqual(64);
    const links = within(dock).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("aria-label") ?? a.textContent)).toEqual(["Accueil", "Articles", "Générer", "Messages", "Affaires"]);
    expect(localStorage.getItem(glassStorageKey(USER_ID))).toBe("on");
    expect(document.getElementById("contenu-app")!.className).toContain("safe-area-inset-bottom");
    fireEvent.click(screen.getByRole("switch", { name: /Essai : verre liquide/ }));
    await waitFor(() => expect(screen.queryByTestId("mobile-dock")).toBeNull());
    expect(document.querySelectorAll(".glass-surface, [data-glass]").length).toBe(0);
    expect(localStorage.getItem(glassStorageKey(USER_ID))).toBe("off");
  });
});

describe("Admin › Supervision", () => {
  it("état de l'API, cibles vérifiées, alertes et dernières vérifications (exemple de la démo)", async () => {
    renderRoutes([{ path: "admin/supervision", element: <AdminSupervision /> }], "/admin/supervision");
    expect(await screen.findByRole("heading", { name: "Cibles vérifiées chaque minute" })).toBeTruthy();
    expect(screen.getByText(/Exemple fixe : aucune vérification réelle/)).toBeTruthy();
    const alerts = screen.getByRole("list", { name: "Alertes de supervision" });
    expect(within(alerts).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Rétabli"), expect.stringContaining("Rappel envoyé"), expect.stringContaining("Alerte envoyée"),
    ]);
    expect(screen.getByRole("link", { name: "Supervision" }).getAttribute("aria-current")).toBe("page");
  });

  it("alerte délivrée à personne : jamais « envoyée », bandeau d'avertissement ; alertes de 7 jours au-delà des dernières vérifications", async () => {
    const client = getDemoClient();
    const real = await client.getHealthDetails();
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    vi.spyOn(client, "getHealthDetails").mockResolvedValue({ ...real, simulated: false, supervision: { ...real.supervision, recent: real.supervision.recent.filter((c) => c.event === null), alerts: [{ target: "api", ok: false, statusCode: 503, latencyMs: 12, error: "HTTP 503", event: "alert", delivered: 0, checkedAt: old }] } });
    renderRoutes([{ path: "admin/supervision", element: <AdminSupervision /> }], "/admin/supervision");
    const alerts = await screen.findByRole("list", { name: "Alertes de supervision" });
    expect(within(alerts).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Alerte NON délivrée")]);
    expect(within(alerts).queryByText(/Alerte envoyée/)).toBeNull();
    expect(screen.getByText("Alerte délivrée à personne")).toBeTruthy();
  });
});
