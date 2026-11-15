import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient, queryClient } from "../lib/data/provider";
import { AppLayout, RequireSession } from "./layout";
import Items from "./pages/Items";
import Journal from "./pages/Journal";
import Overview from "./pages/Overview";
import { MobileDock } from "./components/MobileDock";

/** Selio Manager : journal d'activité, raccourcis personnalisés, « Articles et stock » plus ergonomique. */

function renderRoutes(children: RouteObject[], initial: string) {
  const router = createMemoryRouter([{ path: "/", element: <RequireSession><AppLayout /></RequireSession>, children }], { initialEntries: [initial] });
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
  await getDemoClient().previewRole!(null).catch(() => undefined);
  localStorage.clear();
});

describe("Journal d'activité", () => {
  it("phrases simples groupées par jour ; filtre « Automatique » ; lien vers l'objet", async () => {
    const item = await getDemoClient().createItem({ title: "Veste du journal", listedPriceCents: 3000, status: "listed" });
    const router = renderRoutes([{ path: "app/journal", element: <Journal /> }], "/app/journal");
    expect(await screen.findByRole("heading", { name: "Journal d'activité", level: 1 })).toBeTruthy();
    const line = await screen.findByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Marie Lefèvre a ajouté l'article « Veste du journal »");
    expect(line.closest("a")?.getAttribute("href")).toBe(`/app/items/${item.id}`);
    expect(screen.getByRole("region", { name: "Aujourd'hui" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Automatique/ }));
    await waitFor(() => expect(router.state.location.search).toContain("mode=auto"));
    await waitFor(() => expect(screen.queryByText(/Veste du journal/)).toBeNull());
    expect(screen.getAllByText("Automatique").length).toBeGreaterThan(1);
  });

  it("exécuteur : aucun prix d'achat dans le journal", async () => {
    getDemoClient().recordDemoActivity({ verb: "bot.purchase", itemTitle: "Sac Longchamp", purchaseCents: 1200 });
    await getDemoClient().previewRole!("operator");
    queryClient.clear();
    renderRoutes([{ path: "app/journal", element: <Journal /> }], "/app/journal?type=bot");
    await screen.findByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Selio Bot a acheté « Sac Longchamp »");
    expect(document.body.textContent).not.toContain("12,00");
  });
});

describe("raccourcis personnalisés", () => {
  it("vue d'ensemble : raccourcis par défaut, éditeur (retirer, monter, ajouter), enregistrés, puis défaut rétabli", async () => {
    renderRoutes([{ path: "app", element: <Overview /> }], "/app");
    const nav = await screen.findByRole("navigation", { name: "Raccourcis" });
    await waitFor(() => expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/app/items", "/app/messages", "/app/radar", "/app/items/new", "/app/items/import", "/studio", "/app/orders?status=paid", "/track"]));
    fireEvent.click(within(nav).getByRole("button", { name: "Modifier les raccourcis" }));
    const dialog = await screen.findByRole("dialog", { name: "Personnaliser les raccourcis" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer Articles et stock" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter Journal d'activité" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Monter Journal d'activité" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Raccourcis" })).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/app/messages", "/app/radar", "/app/items/new", "/app/items/import", "/studio", "/app/orders?status=paid", "/app/journal", "/track"]));
    expect((await getDemoClient().getPreferences()).shortcuts).toEqual(["messages", "radar", "new_item", "import_items", "studio", "orders_to_ship", "journal", "track"]);
    fireEvent.click(screen.getByRole("button", { name: "Modifier les raccourcis" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Raccourcis par défaut" }));
    await waitFor(async () => expect((await getDemoClient().getPreferences()).shortcuts).toBeNull());
  });

  it("dock mobile : l'accueil, puis les trois premiers raccourcis (hors Studio)", async () => {
    await getDemoClient().updatePreferences({ shortcuts: ["studio", "journal", "orders_to_ship", "customers"] });
    renderRoutes([{ path: "app", element: <MobileDock /> }], "/app");
    const dock = await screen.findByTestId("mobile-dock");
    await waitFor(() => expect(within(dock).getAllByRole("link").map((a) => a.textContent)).toEqual(["Accueil", "Journal", "", "À expédier", "Clients"]));
  });
});

describe("Articles et stock", () => {
  it("compteurs, prix modifié sur place, suppression groupée confirmée dans la page, « / » pour chercher", async () => {
    const item = await getDemoClient().createItem({ title: "Article à éditer vite", listedPriceCents: 2000, status: "listed" });
    renderRoutes([{ path: "app/items", element: <Items /> }], "/app/items?q=éditer");
    await screen.findByRole("heading", { name: "Articles et stock" });
    expect(await screen.findByText("Vendus ce mois")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Modifier le prix de Article à éditer vite" }));
    const input = screen.getByRole("textbox", { name: "Nouveau prix de Article à éditer vite" });
    fireEvent.change(input, { target: { value: "24,9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(async () => expect((await getDemoClient().getItem(item.id)).listedPriceCents).toBe(2490));

    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner Article à éditer vite" }));
    const bar = await screen.findByRole("region", { name: "Actions groupées" });
    fireEvent.click(within(bar).getByRole("button", { name: "Supprimer" }));
    const confirm = within(bar).getByRole("alertdialog", { name: "Confirmer la suppression" });
    expect(confirm.textContent).toMatch(/Supprimer 1 article\(s\) \?/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer définitivement" }));
    await waitFor(async () => expect((await getDemoClient().listItems({ q: "éditer" })).total).toBe(0));

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Recherche" }));
  });
});
