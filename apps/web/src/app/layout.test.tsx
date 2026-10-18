import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useRouteError } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { useState, type ReactNode } from "react";
import { DataProvider, getDemoClient, queryClient, useRequiredSession, useSession } from "../lib/data/provider";
import { AppLayout, RequireSession } from "./layout";

function Failure() {
  const err = useRouteError();
  return <p data-testid="route-error">{err instanceof Error ? err.message : String(err)}</p>;
}

/** Comme RequireSession, mais ne se rend plus jamais à jour une fois la session chargée. */
function SessionLoadedOnce({ children }: { children: ReactNode }) {
  const q = useSession();
  const [ready, setReady] = useState(false);
  if (q.data && !ready) setReady(true);
  return ready ? <>{children}</> : null;
}

/** Page enfant qui lit la session (comme Paramètres → Données). */
function PageWithSession() {
  const session = useRequiredSession();
  return <p>page-accueil · {session.org.name}</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("mise en page de l'application", () => {
  // Chrome/Edge 149-150 et suivants : window.scrollTo() renvoie une promesse (CSSOM View).
  // Un effet `() => window.scrollTo(…)` la renvoyait à React, qui l'appelait comme fonction de
  // nettoyage à la navigation suivante : « S is not a function » à chaque changement de page.
  it("change de page sans erreur quand scrollTo renvoie une promesse", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((() => Promise.resolve()) as unknown as typeof window.scrollTo);
    await getDemoClient().login({ email: "marie@demo.selio.local", password: "demo" });
    const router = createMemoryRouter(
      [
        {
          path: "/app",
          element: (
            <RequireSession>
              <AppLayout />
            </RequireSession>
          ),
          errorElement: <Failure />,
          children: [
            { index: true, element: <p>page-accueil</p> },
            { path: "items", element: <p>page-stock</p> },
            { path: "messages", element: <p>page-messagerie</p> },
          ],
        },
      ],
      { initialEntries: ["/app"] },
    );
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );
    expect(await screen.findByText("page-accueil")).toBeTruthy();
    await act(() => router.navigate("/app/items"));
    expect(await screen.findByText("page-stock")).toBeTruthy();
    await act(() => router.navigate("/app/messages"));
    expect(await screen.findByText("page-messagerie")).toBeTruthy();
    expect(screen.queryByTestId("route-error")).toBeNull();
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  // Déconnexion ou suppression de l'organisation : la session devient nulle pendant que la mise en
  // page est encore affichée. Chaque composant abonné à la session peut alors être rendu seul, avant
  // que RequireSession ne redirige : `session.data!.org` levait « Cannot read properties of null » et
  // l'écran d'erreur apparaissait le temps de la redirection. Le test monte AppLayout sans
  // RequireSession (qui redirigerait) pour reproduire ce rendu de façon déterministe.
  it.each(["déconnexion", "suppression de l'organisation"])("ne plante pas quand la session se termine (%s)", async (cas) => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const client = getDemoClient();
    await client.login({ email: "marie@demo.selio.local", password: "demo" });
    queryClient.clear();
    const router = createMemoryRouter(
      [
        {
          path: "/app",
          element: (
            <SessionLoadedOnce>
              <AppLayout />
            </SessionLoadedOnce>
          ),
          errorElement: <Failure />,
          children: [{ index: true, element: <PageWithSession /> }],
        },
      ],
      { initialEntries: ["/app"] },
    );
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );
    expect(await screen.findByText(/page-accueil ·/, {}, { timeout: 3000 })).toBeTruthy();
    const session = await client.getSession();
    await act(async () => {
      if (cas === "déconnexion") await client.logout();
      else await client.deleteOrganization(session!.org.name);
    });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByTestId("route-error")).toBeNull();
    // La dernière session connue reste affichée jusqu'à la redirection.
    expect(screen.getByText(/page-accueil ·/)).toBeTruthy();
  });
});

describe("espaces Selio dans la mise en page", () => {
  it("affiche le menu de l'espace, le garde sur les pages communes et propose Selio et ses filiales", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await getDemoClient().login({ email: "marie@demo.selio.local", password: "demo" });
    queryClient.clear();
    const shell = (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    );
    const router = createMemoryRouter(
      [
        { path: "/studio", element: shell, errorElement: <Failure />, children: [{ index: true, element: <p>page-studio</p> }] },
        { path: "/app", element: shell, errorElement: <Failure />, children: [{ index: true, element: <p>page-selio</p> }, { path: "settings", element: <p>page-parametres</p> }] },
      ],
      { initialEntries: ["/studio"] },
    );
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );
    const menu = () => screen.getByRole("navigation", { name: "Navigation de l'application" });
    expect(await screen.findByText("page-studio")).toBeTruthy();
    expect(within(menu()).getByRole("link", { name: /Annonces générées/ })).toBeTruthy();
    expect(within(menu()).queryByRole("link", { name: /Articles et stock/ })).toBeNull();
    // Paramètres : page commune, le menu de Studio reste affiché.
    await act(() => router.navigate("/app/settings"));
    expect(await screen.findByText("page-parametres")).toBeTruthy();
    expect(within(menu()).getByRole("link", { name: /Annonces générées/ })).toBeTruthy();
    await act(() => router.navigate("/app"));
    expect(await screen.findByText("page-selio")).toBeTruthy();
    expect(within(menu()).getByRole("link", { name: /Articles et stock/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Changer d'espace/ }));
    const picker = screen.getByRole("navigation", { name: "Changer d'espace" });
    expect(within(picker).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/app", "/studio", "/agents", "/track", "/cloud", "/generateur", "/app/espaces"]);
    // Échap referme la liste et rend le focus au sélecteur.
    within(picker).getAllByRole("link")[1]!.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Changer d'espace" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Changer d'espace/ }));
    expect(screen.queryByTestId("route-error")).toBeNull();
  });
});
