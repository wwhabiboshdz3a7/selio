import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { RequireSession } from "../../layout";
import Usage, { nextResetDate } from "./Usage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Paramètres › Utilisation", () => {
  it("la remise à zéro tombe le 1er du mois suivant (UTC)", () => {
    expect(nextResetDate("2026-10-01T00:00:00.000Z").toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextResetDate("2026-12-01T00:00:00.000Z").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("une jauge par compteur avec « utilisé / quota », pourcentage, date de remise à zéro et alerte à 80 %", async () => {
    const client = getDemoClient();
    await client.resetDemo();
    await client.login({ email: "marie@demo.selio.local", password: "demo" });
    queryClient.clear();
    const usage = await client.getUsage();
    const router = createMemoryRouter([{ path: "/app/settings/usage", element: <RequireSession><Usage /></RequireSession> }], { initialEntries: ["/app/settings/usage"] });
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Mon utilisation" })).toBeTruthy();
    expect(screen.getByText(/remise à zéro le/).textContent).toMatch(/1er|1 /);
    // Les sept compteurs demandés, chacun avec sa barre.
    const names = ["Réponses de mon IA perso", "Actions automatiques aujourd'hui", "Annonces Studio", "Photos portées", "Scans de niche", "Recherches par photo", "Actions Cloud aujourd'hui"];
    for (const name of names) expect(screen.getByRole("progressbar", { name })).toBeTruthy();
    const studio = screen.getByRole("progressbar", { name: "Annonces Studio" });
    expect(studio.getAttribute("aria-valuenow")).toBe(String(usage.studio.listings.percent));
    expect(studio.getAttribute("aria-valuetext")).toBe(`${usage.studio.listings.percent} % (${usage.studio.listings.used} sur 20)`);
    const ai = screen.getByRole("progressbar", { name: "Réponses de mon IA perso" });
    // La jauge montre la limite réellement appliquée (plan ou réglage de l'organisation, le plus petit), pas le plan seul.
    expect(ai.getAttribute("aria-valuetext")).toContain(`sur ${usage.counters.aiRequests.quota.toLocaleString("fr-FR")}`);
    expect(usage.counters.aiRequests.quota).toBeLessThanOrEqual(usage.quotas.aiRequestsPerMonth);
    // « utilisé / quota » en toutes lettres à côté de chaque jauge.
    expect(screen.getByText(`${usage.studio.listings.used} / 20`)).toBeTruthy();
    // L'alerte globale dit si un compteur a atteint 80 % ; sinon, elle l'écrit aussi.
    const alerts = screen.getAllByRole(usage.warning ? "alert" : "status");
    expect(alerts.some((a) => /80 %/.test(a.textContent ?? ""))).toBe(true);
    // Les filiales en développement sont signalées, sans inventer d'usage.
    expect(screen.getAllByText("En développement").length).toBeGreaterThanOrEqual(1);
    // Selio Cloud a ses pages (aperçu) : inclus dans Agence, en option avec Pro à prix à décider.
    expect(screen.getByText("Inclus dans Agence ; en option avec Pro, prix à décider.")).toBeTruthy();
    const photos = screen.getByRole("progressbar", { name: "Photos portées" }).parentElement!;
    expect(within(photos).getByText("En préparation")).toBeTruthy();
  });
});
