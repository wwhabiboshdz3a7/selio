import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useRouteError } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient } from "../lib/data/provider";
import { AppLayout, RequireSession } from "./layout";

function Failure() {
  const err = useRouteError();
  return <p data-testid="route-error">{err instanceof Error ? err.message : String(err)}</p>;
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
});
