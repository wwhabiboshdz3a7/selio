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
    // Les cinq filiales, dans l'ordre officiel, puis Selio Cloud et Selio Agent, intégrés à Selio Manager.
    expect(screen.getAllByRole("article").map((a) => a.querySelector("h2, h3")?.textContent)).toEqual(["Selio Manager", "Selio Studio", "Selio Track", "Selio Bot", "Selio Compte", "Selio Cloud", "Selio Agent"]);
    expect(screen.getAllByText(/^Filiale \d$/).map((e) => e.textContent)).toEqual(["Filiale 1", "Filiale 2", "Filiale 3", "Filiale 4", "Filiale 5"]);
    expect(screen.queryByRole("article", { name: "Selio Global" })).toBeNull();
    expect(screen.queryByText("Selio Agents")).toBeNull();
    expect(screen.queryByText("Selio Comptes")).toBeNull();
    // Selio Manager : ses fonctionnalités intégrées sous sa carte.
    const integrated = within(card("Selio Manager")).getByRole("group", { name: "Intégrés à Selio Manager" });
    expect(within(integrated).getByRole("link", { name: "Selio Cloud" }).getAttribute("href")).toBe("/cloud");
    expect(within(integrated).getByRole("link", { name: "Selio Agent" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByRole("heading", { name: "Intégrés à Selio Manager", level: 2 })).toBeTruthy();
    // États honnêtes.
    expect(within(card("Selio Manager")).getByText("Disponible")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir Selio Manager" }).textContent).toContain("Ouvrir Selio Manager");
    expect(within(card("Selio Agent")).getAllByText("Aperçu").length).toBeGreaterThan(0);
    expect(within(card("Selio Track")).getByText("En développement")).toBeTruthy();
    // Selio Bot : recherche et achat d'articles, inclus selon le forfait, achat automatique fermé.
    const bot = card("Selio Bot");
    expect(within(bot).getByText("Disponible")).toBeTruthy();
    expect(within(bot).getByText("Recherche et achat d'articles")).toBeTruthy();
    expect(within(bot).getByText(/inclus selon votre forfait/)).toBeTruthy();
    expect((await within(bot).findByText("Achat automatique")).nextElementSibling?.textContent).toBe("Fermé");
    expect(screen.getByRole("link", { name: "Ouvrir Selio Bot" }).getAttribute("href")).toBe("/bot");
    // Selio Compte : services liés aux comptes, devis, avec l'avancement de la checklist.
    const compte = card("Selio Compte");
    expect(within(compte).getByText("Disponible")).toBeTruthy();
    expect(within(compte).getByText("Services liés aux comptes et accompagnement")).toBeTruthy();
    expect(within(compte).getByText("Checklist").nextElementSibling?.textContent).toMatch(/^0\/\d+$/);
    expect(within(compte).getByRole("link", { name: "Demander un devis" }).getAttribute("href")).toBe("/contact?sujet=comptes");
    // Selio Cloud : en aperçu, avec ses chiffres (comptes de la démonstration) et l'état de l'accord.
    const cloud = card("Selio Cloud");
    expect(within(cloud).getAllByText("Aperçu").length).toBeGreaterThan(0);
    expect((await within(cloud).findByText("Comptes Cloud")).nextElementSibling?.textContent).toBe("2");
    expect(await within(cloud).findByText("Accord à donner avant toute action")).toBeTruthy();
    expect(within(card("Selio Agent")).getAllByText(/fictives|exemples fictifs/).length).toBeGreaterThan(0);
    // Studio : nombre d'annonces générées calculé depuis l'état de la démo, et leurs vignettes.
    const studio = card("Selio Studio");
    const figure = await within(studio).findByText("Annonces générées");
    expect(figure.nextElementSibling?.textContent).toBe(String(generated.length));
    expect(within(studio).getByRole("list", { name: "Dernières annonces générées" }).children.length).toBe(Math.min(5, generated.length));
    // Chaque filiale s'ouvre depuis sa carte.
    expect(screen.getByRole("link", { name: "Ouvrir Selio Agent" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByRole("link", { name: "Ouvrir Selio Cloud" }).getAttribute("href")).toBe("/cloud");
    expect(screen.getByRole("link", { name: "Ouvrir Selio Track" }).getAttribute("href")).toBe("/track");
    expect(screen.getByRole("link", { name: "Ouvrir Selio Compte" }).getAttribute("href")).toBe("/comptes");
  });
});
