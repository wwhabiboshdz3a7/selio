import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATION_FORBIDDEN_NOTE } from "@selio/domain";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { RequireSession } from "../../layout";
import Migration, { confidenceLabel, targetValueLabel } from "./Migration";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pasted = `Réglages exportés depuis Bleam
Remise max : 20 %
Marge minimum : 5 €
Horaires : 9h-21h
Couleur du thème : sombre`;

async function renderMigration() {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  queryClient.clear();
  const router = createMemoryRouter([{ path: "/app/settings/migration", element: <RequireSession><Migration /></RequireSession> }], { initialEntries: ["/app/settings/migration"] });
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
  await screen.findByRole("heading", { name: "Migration depuis un autre outil" });
  return client;
}

describe("Paramètres › Migration", () => {
  it("bandeau d'interdictions : aucun identifiant demandé, aucune connexion à l'autre outil, aucun champ mot de passe", async () => {
    await renderMigration();
    const banner = screen.getByRole("region", { name: "Ce que la migration ne fait jamais" });
    expect(banner.textContent).toContain(MIGRATION_FORBIDDEN_NOTE);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText(/identifiant|mot de passe/i)).toBeNull();
  });

  it("texte collé → écran ancien → nouveau avec cases, confiance et inconnus ; seuls les champs cochés sont appliqués", async () => {
    const client = await renderMigration();
    const before = (await client.getSession())!.org.settings;
    fireEvent.change(screen.getByRole("textbox", { name: /Vos réglages/ }), { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Convertir mes réglages" }));
    const review = await screen.findByRole("region", { name: "Correspondance ancien → nouveau" }, { timeout: 4000 });
    // Une ligne par réglage reconnu, avec sa case, sa cible Selio, sa valeur et sa confiance.
    const discount = within(review).getByRole("checkbox", { name: "Reprendre « Remise max »" }) as HTMLInputElement;
    const minMargin = within(review).getByRole("checkbox", { name: "Reprendre « Marge minimum »" }) as HTMLInputElement;
    expect(within(review).getByText("Remise maximale")).toBeTruthy();
    // Ancienne valeur « 20 % » et nouvelle valeur Selio « 20 % » (taux converti), côte à côte.
    expect(within(review).getAllByText("20 %")).toHaveLength(2);
    // Confiance par champ, en pourcentage et en toutes lettres.
    const badges = within(review).getAllByText((_, el) => el?.tagName === "SPAN" && /^\d+ % · (élevée|moyenne|faible)$/.test(el.textContent ?? ""));
    expect(badges.length).toBe(within(review).getAllByRole("checkbox").length);
    // Le réglage sans équivalent est montré comme « inconnu », jamais appliqué.
    const unknown = within(review).getByRole("region", { name: "Réglages inconnus" });
    expect(within(unknown).getByText("Couleur du thème")).toBeTruthy();
    expect(within(unknown).getAllByText("Inconnu").length).toBe(1);
    // On ne garde que la remise maximale.
    if (!discount.checked) fireEvent.click(discount);
    if (minMargin.checked) fireEvent.click(minMargin);
    for (const box of within(review).getAllByRole("checkbox") as HTMLInputElement[]) if (box !== discount && box.checked) fireEvent.click(box);
    fireEvent.click(within(review).getByRole("button", { name: "Appliquer 1 réglage(s)" }));
    // Le compte rendu (et la notification) disent combien de réglages ont été repris.
    expect((await screen.findAllByText("1 réglage(s) appliqué(s)")).length).toBeGreaterThan(0);
    const after = (await client.getSession())!.org.settings;
    expect(after.margin.maxDiscountRate).toBe(0.2);
    expect(after.margin.minMarginCents).toBe(before.margin.minMarginCents);
    expect(after.automation.negotiation.timing).toEqual(before.automation.negotiation.timing);
  });

  it("libellés : confiance en toutes lettres, valeurs Selio lisibles", () => {
    expect(confidenceLabel(0.95)).toEqual({ label: "élevée", tone: "success" });
    expect(confidenceLabel(0.65).label).toBe("moyenne");
    expect(confidenceLabel(0.4).label).toBe("faible");
    expect(targetValueLabel("marginRules.maxDiscountRate", { targetValue: 0.2, sourceValue: "20 %" })).toBe("20 %");
    expect(targetValueLabel("marginRules.minMarginCents", { targetValue: null, sourceValue: "5 €" })).toMatch(/5,00/);
    expect(targetValueLabel("autoReply.enabled", { targetValue: true, sourceValue: "oui" })).toBe("Oui");
    expect(targetValueLabel(null, { targetValue: null, sourceValue: "x" })).toBe("—");
  });
});
