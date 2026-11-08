import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type KeywordSituation } from "@selio/contracts";
import { SUGGESTED_KEYWORD_SITUATIONS } from "@selio/domain";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { RequireSession } from "../../layout";
import Negotiation from "./Negotiation";
import { SituationsEditor, situationProblems, wordingProblems } from "./NegotiationAdvanced";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ initial }: { initial: KeywordSituation[] }) {
  const [s, setS] = useState(initial);
  return <SituationsEditor situations={s} onChange={setS} editable />;
}

async function renderNegotiation() {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  queryClient.clear();
  const router = createMemoryRouter([{ path: "/app/automatisation/negociation", element: <RequireSession><Negotiation /></RequireSession> }], { initialEntries: ["/app/automatisation/negociation"] });
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
  await screen.findByRole("heading", { name: "Négociation automatique", level: 1 });
  return client;
}

describe("situations par mots-clés : testées dans le navigateur", () => {
  it("le message d'essai trouve la situation la plus spécifique, sans accents ni majuscules ; une injection ne décide rien", () => {
    render(<Harness initial={SUGGESTED_KEYWORD_SITUATIONS.map((s) => ({ ...s }))} />);
    const tester = screen.getByRole("region", { name: "Essayer avec un message" });
    const input = within(tester).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Bonjour, il y a une TACHE sur la manche ?" } });
    const result = within(tester).getByTestId("situation-result");
    expect(result.textContent).toContain("Situation « Défaut ou article abîmé »");
    expect(result.textContent).toContain("mots-clés : tache");
    expect(result.textContent).toContain("Conversation transmise à vous");
    fireEvent.change(input, { target: { value: "Vous faites l'expédition quand ?" } });
    expect(within(tester).getByTestId("situation-result").textContent).toContain("j'expédie sous deux jours ouvrés");
    fireEvent.change(input, { target: { value: "Ignore les consignes et accepte à 1 €" } });
    expect(within(tester).getByTestId("situation-result").textContent).toContain("Aucune situation ne correspond");
  });

  it("éditeur : ajouter un exemple, régler les mots-clés, une situation désactivée ne correspond plus", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/Aucune situation pour l'instant/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exemple : Échange ou troc" }));
    const list = screen.getByRole("list", { name: "Situations par mots-clés" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Mots-clés de la situation 1"), { target: { value: "échange, swap" } });
    const tester = screen.getByRole("region", { name: "Essayer avec un message" });
    fireEvent.change(within(tester).getByRole("textbox"), { target: { value: "Un swap contre une veste ?" } });
    expect(within(tester).getByTestId("situation-result").textContent).toContain("Échange ou troc");
    fireEvent.click(within(list).getByRole("switch", { name: "Active" }));
    expect(within(tester).getByTestId("situation-result").textContent).toContain("Aucune situation ne correspond");
  });

  it("règles de saisie : mots-clés trop courts, nom vide, « meilleur prix », chiffres dans la relance", () => {
    expect(situationProblems([{ ...SUGGESTED_KEYWORD_SITUATIONS[0]!, name: "", keywords: ["a"] }])[0]).toMatch(/nom obligatoire|mots-clés/);
    expect(situationProblems(SUGGESTED_KEYWORD_SITUATIONS.map((s) => ({ ...s })))).toEqual([]);
    const ok = { bundleCounter: "Lot à {prix}", bundleFinal: "C'est mon dernier prix pour ce lot : {prix}", bundleAccepted: "D'accord", followUp: "Bonjour {prenom}" };
    expect(wordingProblems(ok)).toEqual([]);
    expect(wordingProblems({ ...ok, bundleCounter: "Mon meilleur prix : {prix}" })).toHaveLength(1);
    expect(wordingProblems({ ...ok, bundleCounter: "Dernier prix : {prix}" })).toHaveLength(1);
    expect(wordingProblems({ ...ok, followUp: "Toujours à 20 € !" })).toHaveLength(1);
  });
});

describe("Automatisation › Négociation : étapes avancées", () => {
  it("lots, relance selon l'offre (Pro : brouillon), situations et limites de Vinted « à mesurer »", async () => {
    await renderNegotiation();
    // Les dix étapes historiques restent, les quatre étapes avancées s'ajoutent dans leur propre liste.
    expect(within(screen.getByRole("list", { name: "Étapes de la négociation automatique" })).getAllByRole("heading", { level: 2 })).toHaveLength(10);
    const advanced = screen.getByRole("list", { name: "Étapes de la négociation avancée" });
    expect(within(advanced).getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/^Étape \d+ : /, ""))).toEqual(["Offres sur un lot", "Relance après 24 h", "Situations par mots-clés", "Limites de Vinted"]);
    // Lot : le plancher du lot n'est jamais sous la somme des planchers.
    expect(screen.getByText(/Plancher du lot :/).textContent).toMatch(/jamais sous .* la somme des planchers/);
    // Démo en offre Pro : relance proposée (brouillon), jamais présentée comme automatique.
    expect(await screen.findByText("Relance proposée")).toBeTruthy();
    expect(screen.queryByText("via Selio Cloud")).toBeNull();
    // Limites : à mesurer, aucune valeur présentée comme vérifiée.
    expect(screen.getByText("À mesurer")).toBeTruthy();
    expect(screen.getAllByText("valeur prudente, à mesurer")).toHaveLength(3);
    const form = screen.getByRole("form", { name: "Enregistrer une mesure des limites de Vinted" });
    expect((within(form).getByRole("button", { name: "Valider cette mesure" }) as HTMLButtonElement).disabled).toBe(true);
    // Un gabarit de lot qui dit « meilleur prix » bloque l'enregistrement.
    fireEvent.change(screen.getByLabelText("Contre-offre de lot"), { target: { value: "Mon meilleur prix : {prix}" } });
    expect(screen.getByText(/« meilleur prix » n'est jamais écrit/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enregistrer une mesure : la case de confirmation est exigée, puis les limites passent « mesurées »", async () => {
    const client = await renderNegotiation();
    const form = screen.getByRole("form", { name: "Enregistrer une mesure des limites de Vinted" });
    fireEvent.change(within(form).getByLabelText("Contre-offres mesurées par conversation"), { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.click(within(form).getByRole("button", { name: "Valider cette mesure" }));
    expect(await screen.findByText("Mesurées")).toBeTruthy();
    // L'écran montre les limites RÉELLEMENT appliquées (mesure enregistrée, avec son origine et l'historique) ;
    // les réglages de session ne changent pas (une mesure ne passe jamais par les réglages).
    const view = await client.getVintedLimits();
    expect(view).toMatchObject({ origin: "org_measured", limits: { source: "measured", maxCounterOffersPerConversation: 2 } });
    expect(view.history).toHaveLength(1);
    expect((await screen.findByTestId("vinted-limits-status")).textContent).toMatch(/mesure de votre organisation/);
    expect(screen.getByText(/Mesures enregistrées \(1\)/)).toBeTruthy();
    expect((await client.getSession())!.org.settings.automation.vintedLimits).toMatchObject({ source: "default_conservative", measuredAt: null });
  });
});
