import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { BOT_AUTO_BUY_LOCKED_TEXT, type Plan, type Role } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { RequireSession } from "../../layout";
import AutomationHub from "../automation/AutomationHub";
import { FollowUpPage, LegacyBotRedirect } from "../automation/AutomationDetail";
import BotAutoBuy from "./BotAutoBuy";
import BotHome from "./BotHome";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function demo({ plan, role }: { plan?: Plan; role?: Role } = {}) {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  if (plan) await client.adminSetPlan((await client.getSession())!.org.id, plan);
  if (role) await client.previewRole(role);
  queryClient.clear();
  return client;
}

function mount(path: string, pattern: string, element: ReactNode) {
  const router = createMemoryRouter([{ path: pattern, element: <RequireSession>{element}</RequireSession> }, { path: "*", element: <p>autre page</p> }], { initialEntries: [path] });
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
  return router;
}

const row = (id: string) => document.querySelector(`[data-bot="${id}"]`) as HTMLElement;

describe("Selio Bot : recherche et achat d'articles (démonstration)", () => {
  it("accueil : recherches actives, bonnes affaires notées sur 100 avec revente et marge, alertes, limites, historique, deux modes d'achat", async () => {
    await demo();
    mount("/bot", "/bot", <BotHome />);
    expect(await screen.findByRole("heading", { name: "Selio Bot : recherche et achat d'articles", level: 1 })).toBeTruthy();
    for (const title of ["Bonnes affaires notées sur 100", "Recherches actives", "Alertes", "Limites de dépenses", "Historique des achats"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    const deals = await screen.findByRole("list", { name: "Meilleures affaires" });
    const first = within(deals).getAllByRole("listitem")[0]!;
    expect(within(first).getByText(/revente estimée/)).toBeTruthy();
    expect(within(first).getByText(/marge potentielle/)).toBeTruthy();
    expect(within(first).getByRole("link").getAttribute("href")).toMatch(/^\/app\/radar\/affaires\//);
    expect((await screen.findByRole("list", { name: "Recherches" })).children.length).toBeGreaterThan(0);
    // Deux modes : achat rapide en 1 clic (disponible) et achat automatique, verrouillé avec la phrase juridique.
    expect(await screen.findByTestId("mode-assisted")).toBeTruthy();
    const auto = screen.getByTestId("mode-auto");
    expect(within(auto).getByText("Verrouillé")).toBeTruthy();
    expect(within(auto).getByText(BOT_AUTO_BUY_LOCKED_TEXT)).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-server-lock="closed"]').length).toBe(2));
    // Plus aucune automatisation de compte dans Selio Bot : elles sont dans Selio Manager.
    expect(document.querySelectorAll("[data-bot]").length).toBe(0);
    expect(screen.queryByRole("button", { name: /Tout arrêter|Arrêter toutes les automatisations/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Selio Manager › Automatisation" }).getAttribute("href")).toBe("/app/automatisation");
  });

  it("achat automatique : deux modes et deux verrous du serveur fermés, réglages en lecture seule", async () => {
    await demo({ plan: "agence" });
    mount("/bot/achat-auto", "/bot/achat-auto", <BotAutoBuy />);
    expect(await screen.findByRole("heading", { name: "Achat automatique", level: 1 })).toBeTruthy();
    expect(await screen.findByTestId("mode-assisted")).toBeTruthy();
    expect(screen.getByTestId("mode-auto")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-server-lock="closed"]').length).toBe(2));
    expect(screen.getByText("1. Achat automatique (RADAR_AUTO_ENABLED)")).toBeTruthy();
    expect(screen.getByText("2. Achat réel (RADAR_REAL_PURCHASE)")).toBeTruthy();
    expect(await screen.findByTestId("auto-readonly")).toBeTruthy();
  });

  it("anciennes adresses /bot/negociation… : redirigées vers les automatisations de Selio Manager", async () => {
    await demo();
    const router = mount("/bot/negociation", "/bot/:slug", <LegacyBotRedirect />);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/automatisation/negociation"));
    cleanup();
    const r2 = mount("/bot/relance", "/bot/:slug", <LegacyBotRedirect />);
    await waitFor(() => expect(r2.state.location.pathname).toBe("/app/automatisation/relances"));
  });
});

describe("Selio Manager › Automatisation : état et arrêt de toutes les automatisations", () => {
  it("tableau d'état : six automatisations de compte (sans l'achat automatique), Favoris « bientôt », lien vers les comptes du Cloud", async () => {
    await demo();
    mount("/app/automatisation", "/app/automatisation", <AutomationHub />);
    expect(await screen.findByRole("heading", { name: "État des automatisations" })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll("[data-bot]").length).toBe(6));
    expect(row("auto_buy")).toBeNull();
    expect(within(row("favorites")).getByText("Bientôt")).toBeTruthy();
    expect(within(row("follow_up")).getAllByRole("link")[0]!.getAttribute("href")).toBe("/app/automatisation/relances");
    expect(within(row("negotiation")).getAllByRole("link")[0]!.getAttribute("href")).toBe("/app/automatisation/negociation");
  });

  it("« Arrêter toutes les automatisations » (titulaire) : confirmation, tout coupé, puis reprise", async () => {
    const client = await demo();
    mount("/app/automatisation", "/app/automatisation", <AutomationHub />);
    fireEvent.click(await screen.findByRole("button", { name: "Arrêter toutes les automatisations" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tout arrêter" }));
    expect(await screen.findByText("Toutes les automatisations sont arrêtées")).toBeTruthy();
    expect((await client.getAutomationState()).globalPaused).toBe(true);
    await waitFor(() => expect(document.querySelectorAll('[data-bot] [data-bot-state="stopped"]').length).toBeGreaterThan(0));
    // L'achat automatique de Selio Bot est coupé aussi.
    expect((await client.botSummary()).bots.find((b) => b.id === "auto_buy")!.state).toBe("stopped");
    fireEvent.click(screen.getByRole("button", { name: "Reprendre les automatisations" }));
    await waitFor(() => expect(screen.queryByText("Toutes les automatisations sont arrêtées")).toBeNull());
    expect((await client.getAutomationState()).globalPaused).toBe(false);
  });

  it("exécuteur : voit l'état, bouton désactivé ; le client démo refuse aussi", async () => {
    const client = await demo({ role: "operator" });
    mount("/app/automatisation", "/app/automatisation", <AutomationHub />);
    const btn = await screen.findByRole("button", { name: "Arrêter toutes les automatisations" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/seuls le titulaire et les administrateurs peuvent arrêter ou reprendre/)).toBeTruthy();
    await expect(client.stopBots()).rejects.toMatchObject({ status: 403 });
  });

  it("page Relances : état, règles et réglages existants", async () => {
    await demo({ plan: "agence" });
    mount("/app/automatisation/relances", "/app/automatisation/relances", <FollowUpPage />);
    expect(await screen.findByRole("heading", { name: "Relances", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Texte de la relance" }).getAttribute("href")).toBe("/app/automatisation/negociation");
    expect(await screen.findByRole("heading", { name: "Règles" })).toBeTruthy();
  });
});
