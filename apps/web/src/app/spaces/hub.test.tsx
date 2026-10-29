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
  it("présente Selio et ses filiales, leur état et des chiffres tirés des données de la démo", async () => {
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

    expect(await screen.findByRole("heading", { name: "Selio et ses filiales" })).toBeTruthy();
    const card = (name: string) => screen.getByRole("article", { name });
    for (const name of ["Selio", "Selio Studio", "Selio Agents", "Selio Track", "Selio Cloud", "Générateur de compte Vinted"]) expect(card(name)).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Selio Global" })).toBeNull();
    // États honnêtes.
    expect(within(card("Selio")).getByText("Disponible")).toBeTruthy();
    expect(within(card("Selio Agents")).getAllByText("Aperçu").length).toBeGreaterThan(0);
    for (const name of ["Selio Track", "Générateur de compte Vinted"]) expect(within(card(name)).getByText("En développement")).toBeTruthy();
    // Selio Cloud : en aperçu, avec ses chiffres (comptes de la démonstration) et l'état de l'accord.
    const cloud = card("Selio Cloud");
    expect(within(cloud).getAllByText("Aperçu").length).toBeGreaterThan(0);
    expect((await within(cloud).findByText("Comptes Cloud")).nextElementSibling?.textContent).toBe("2");
    expect(await within(cloud).findByText("Accord à donner avant toute action")).toBeTruthy();
    expect(within(card("Selio Agents")).getAllByText(/fictives|exemples fictifs/).length).toBeGreaterThan(0);
    // Studio : nombre d'annonces générées calculé depuis l'état de la démo, et leurs vignettes.
    const studio = card("Selio Studio");
    const figure = await within(studio).findByText("Annonces générées");
    expect(figure.nextElementSibling?.textContent).toBe(String(generated.length));
    expect(within(studio).getByRole("list", { name: "Dernières annonces générées" }).children.length).toBe(Math.min(5, generated.length));
    // Chaque filiale s'ouvre depuis sa carte.
    expect(screen.getByRole("link", { name: "Ouvrir Selio Agents" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByRole("link", { name: "Ouvrir Selio Cloud" }).getAttribute("href")).toBe("/cloud");
    expect(screen.getByRole("link", { name: "Découvrir Selio Track" }).getAttribute("href")).toBe("/track");
  });
});
