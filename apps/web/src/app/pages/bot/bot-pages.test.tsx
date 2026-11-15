import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { BOT_AUTO_BUY_LOCKED_TEXT, type Plan, type Role } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { RequireSession } from "../../layout";
import BotAutoBuy from "./BotAutoBuy";
import BotDetail from "./BotDetail";
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

const card = (id: string) => document.querySelector(`[data-bot="${id}"]`) as HTMLElement;

describe("Selio Bot (démonstration)", () => {
  it("tableau des bots : sept bots, Favoris « bientôt », achat auto verrouillé avec la phrase juridique, lien vers les comptes du Cloud", async () => {
    await demo();
    mount("/bot", "/bot", <BotHome />);
    expect(await screen.findByRole("heading", { name: "Vos bots" })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll("[data-bot]").length).toBe(7));
    expect(within(card("favorites")).getByText("Bientôt")).toBeTruthy();
    expect(within(card("auto_buy")).getByText("Verrouillé")).toBeTruthy();
    expect(within(card("auto_buy")).getByText(BOT_AUTO_BUY_LOCKED_TEXT)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Comptes dans le Cloud" }).getAttribute("href")).toBe("/cloud/comptes");
    expect(screen.getByText("Démonstration")).toBeTruthy();
  });

  it("« Tout arrêter » (titulaire) : confirmation, bots coupés, puis reprise", async () => {
    const client = await demo();
    mount("/bot", "/bot", <BotHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Tout arrêter" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tout arrêter" }));
    expect(await screen.findByText("Tout est arrêté")).toBeTruthy();
    expect((await client.getAutomationState()).globalPaused).toBe(true);
    await waitFor(() => expect(within(card("auto_buy")).getByText("Tout arrêté")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reprendre" }));
    await waitFor(() => expect(screen.queryByText("Tout est arrêté")).toBeNull());
    expect((await client.getAutomationState()).globalPaused).toBe(false);
  });

  it("exécuteur : voit l'état, bouton « Tout arrêter » désactivé ; le client démo refuse aussi", async () => {
    const client = await demo({ role: "operator" });
    mount("/bot", "/bot", <BotHome />);
    const btn = await screen.findByRole("button", { name: "Tout arrêter" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/seuls le titulaire et les administrateurs peuvent tout arrêter/)).toBeTruthy();
    await expect(client.stopBots()).rejects.toMatchObject({ status: 403 });
  });

  it("page d'un bot : règles du bot, réglages existants ; achat auto : deux modes et deux verrous du serveur fermés", async () => {
    await demo({ plan: "agence" });
    mount("/bot/negociation", "/bot/:botId", <BotDetail />);
    expect(await screen.findByRole("heading", { name: "Négociation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Planchers, paliers et messages" }).getAttribute("href")).toBe("/app/automatisation/negociation");
    expect(await screen.findByText("Règles du bot")).toBeTruthy();
    cleanup();
    queryClient.clear();
    mount("/bot/achat-auto", "/bot/achat-auto", <BotAutoBuy />);
    expect(await screen.findByTestId("mode-assisted")).toBeTruthy();
    expect(screen.getByTestId("mode-auto")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-server-lock="closed"]').length).toBe(2));
    expect(screen.getByText("1. Achat automatique (RADAR_AUTO_ENABLED)")).toBeTruthy();
    expect(screen.getByText("2. Achat réel (RADAR_REAL_PURCHASE)")).toBeTruthy();
    // Réglages de Radar Auto repris tels quels (lecture seule tant que le verrou serveur est fermé).
    expect(await screen.findByTestId("auto-readonly")).toBeTruthy();
  });
});
