import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { isGenerated } from "@selio/domain";
import { DataProvider, getDemoClient, queryClient } from "../../lib/data/provider";
import { RequireSession } from "../layout";
import Hub from "./pages/Hub";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("accueil central des espaces", () => {
  it("présente les quatre espaces, leur état et des chiffres tirés des données de la démo", async () => {
    const client = getDemoClient();
    await client.resetDemo();
    await client.login({ email: "marie@demo.selio.local", password: "demo" });
    queryClient.clear();
    const items = (await client.listItems({ pageSize: 200 })).items;
    const generated = items.filter(isGenerated);
    const router = createMemoryRouter([{ path: "/app/espaces", element: <RequireSession><Hub /></RequireSession> }], { initialEntries: ["/app/espaces"] });
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Vos espaces Selio" })).toBeTruthy();
    const card = (name: string) => screen.getByRole("article", { name });
    for (const name of ["Selio", "Selio Studio", "Selio Agence", "Selio Global"]) expect(card(name)).toBeTruthy();
    // États honnêtes.
    expect(within(card("Selio")).getByText("Disponible")).toBeTruthy();
    expect(within(card("Selio Agence")).getByText("Aperçu")).toBeTruthy();
    expect(within(card("Selio Global")).getByText("En préparation")).toBeTruthy();
    expect(within(card("Selio Agence")).getAllByText(/Exemple fictif|exemples fictifs/).length).toBeGreaterThan(0);
    // Studio : nombre d'annonces générées calculé depuis l'état de la démo, et leurs vignettes.
    const studio = card("Selio Studio");
    const figure = await within(studio).findByText("Annonces générées");
    expect(figure.nextElementSibling?.textContent).toBe(String(generated.length));
    expect(within(studio).getByRole("list", { name: "Dernières annonces générées" }).children.length).toBe(Math.min(5, generated.length));
    // Global : la France seule est ouverte, les autres marchés sont listés.
    const markets = within(card("Selio Global")).getByRole("list", { name: "Marchés" });
    expect(within(markets).getByText(/France : Disponible/)).toBeTruthy();
    expect(within(markets).getAllByRole("listitem").length).toBe(10);
    // Chaque espace s'ouvre depuis sa carte.
    expect(screen.getByRole("link", { name: "Ouvrir Selio Agence" }).getAttribute("href")).toBe("/agence");
  });
});
