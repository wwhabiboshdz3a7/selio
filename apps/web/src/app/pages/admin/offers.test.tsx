import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { DISMISSED_OFFERS_KEY, promoCodeFromSearch } from "../../../lib/offers";
import { DEMO_OFFERS_KEY, MemoryDemoOfferStore } from "../../../lib/demo/offers";
import { DemoClient } from "../../../lib/demo/client";
import { MemoryDemoStorage } from "@selio/demo-data";
import { AppLayout, RequireSession } from "../../layout";
import { OfferBanner } from "../../components/offers";
import Billing from "../settings/Billing";
import { AdminOffers, offerFromForm } from "./Offers";

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

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

beforeEach(async () => {
  localStorage.clear();
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  queryClient.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const FORM = { name: "Printemps", code: "printemps", discountKind: "percent" as const, discountValue: "20", plans: ["pro" as const], durationKind: "always" as const, durationMonths: "", startsOn: "", endsOn: "", maxRedemptions: "", bannerEnabled: true, bannerText: "", active: true };

describe("Admin › Offres : formulaire (validation claire)", () => {
  it("formulaire valide → offre au format du serveur ; erreurs par champ sinon", () => {
    expect(offerFromForm(FORM)).toEqual({ errors: {}, input: expect.objectContaining({ name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: null, bannerEnabled: true, active: true }) });
    expect(offerFromForm({ ...FORM, discountKind: "amount", discountValue: "2,50" }).input).toMatchObject({ discountPercent: null, discountCents: 250 });
    expect(offerFromForm({ ...FORM, name: "", discountValue: "120", code: "a!" }).errors).toEqual({ name: "Nom : 2 caractères au moins", discountValue: "Pourcentage entier entre 1 et 100.", code: "Code promo : 3 à 24 caractères, lettres, chiffres et tirets." });
    expect(offerFromForm({ ...FORM, durationKind: "months", durationMonths: "0" }).errors.durationMonths).toBe("Nombre de mois entre 1 et 36.");
    expect(offerFromForm({ ...FORM, startsOn: "2026-12-10", endsOn: "2026-12-01" }).errors.endsOn).toBe("La fin doit être après le début.");
  });
});

describe("Admin › Offres : liste, création, aperçu du bandeau, activer, supprimer", () => {
  it("crée une offre avec aperçu, la désactive puis la supprime après confirmation dans la page", async () => {
    renderRoutes([{ path: "admin/offres", element: <AdminOffers /> }], "/admin/offres");
    expect(await screen.findByText("Aucune offre pour le moment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle offre/ }));
    const form = screen.getByRole("form", { name: "Nouvelle offre" });
    // Envoi vide : messages clairs, rien n'est créé.
    fireEvent.click(within(form).getByRole("button", { name: "Créer l'offre" }));
    expect(await within(form).findByText("Nom : 2 caractères au moins")).toBeTruthy();
    expect(within(form).getByText("Indiquez la remise.")).toBeTruthy();

    fireEvent.change(within(form).getByLabelText(/Nom affiché/), { target: { value: "Printemps" } });
    fireEvent.change(within(form).getByLabelText(/^Code promo/), { target: { value: "printemps" } });
    fireEvent.change(within(form).getByLabelText(/Remise \(%\)/), { target: { value: "20" } });
    fireEvent.click(within(form).getByLabelText("Pro"));
    fireEvent.click(within(form).getByRole("switch", { name: /Afficher dans le bandeau/ }));
    expect(screen.getByTestId("offer-banner-preview").textContent).toBe("-20 % sur Pro avec le code PRINTEMPS");
    fireEvent.change(within(form).getByLabelText(/Texte du bandeau/), { target: { value: "Le printemps de Selio : -20 % sur Pro" } });
    expect(screen.getByTestId("offer-banner-preview").textContent).toBe("Le printemps de Selio : -20 % sur Pro");
    fireEvent.click(within(form).getByRole("button", { name: "Créer l'offre" }));

    const row = await screen.findByTestId("offer-row-PRINTEMPS");
    expect(row.textContent).toContain("Printemps");
    expect(row.textContent).toContain("-20 %");
    expect(row.textContent).toContain("Pro");
    expect(row.textContent).toContain("Tant que l'abonnement dure");
    expect(row.textContent).toContain("Active");
    expect(within(row).getAllByRole("cell")[6]!.textContent).toBe("0");
    expect(within(row).getAllByRole("cell")[7]!.textContent).toBe("Oui");
    expect(JSON.parse(localStorage.getItem(DEMO_OFFERS_KEY)!)).toHaveLength(1);

    fireEvent.click(within(row).getByRole("button", { name: "Désactiver" }));
    await waitFor(() => expect(screen.getByTestId("offer-row-PRINTEMPS").textContent).toContain("Désactivée"));

    fireEvent.click(within(screen.getByTestId("offer-row-PRINTEMPS")).getByRole("button", { name: "Supprimer l'offre Printemps" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("n'a jamais servi : elle sera supprimée définitivement");
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer l'offre" }));
    expect(await screen.findByText("Aucune offre pour le moment")).toBeTruthy();
  });
});

describe("Bandeau des offres (application et vitrine)", () => {
  it("aucune offre par défaut en démonstration : aucun bandeau", async () => {
    expect(await getDemoClient().getOfferBanner()).toEqual([]);
    renderRoutes([{ index: true, element: <p>Accueil</p> }], "/");
    expect(await screen.findByText("Accueil")).toBeTruthy();
    expect(screen.queryByTestId("offer-banner")).toBeNull();
  });

  it("une offre avec bandeau créée dans l'admin démo s'affiche en haut ; refermée, elle reste fermée (par offre)", async () => {
    const offer = await getDemoClient().adminCreateOffer({ name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: 3, startsAt: null, endsAt: null, maxRedemptions: null, bannerEnabled: true, bannerText: null, active: true });
    renderRoutes([{ index: true, element: <p>Accueil</p> }], "/");
    const banner = await screen.findByTestId("offer-banner");
    expect(banner.textContent).toContain("-20 % sur Pro pendant 3 mois avec le code PRINTEMPS");
    expect(within(banner).getByRole("link", { name: "En profiter" }).getAttribute("href")).toBe("/app/settings/billing");
    fireEvent.click(within(banner).getByRole("button", { name: "Fermer le bandeau de l'offre" }));
    expect(screen.queryByTestId("offer-banner")).toBeNull();
    expect(JSON.parse(localStorage.getItem(DISMISSED_OFFERS_KEY)!)).toEqual([offer.id]);
    cleanup();
    queryClient.clear();
    // Vitrine : la même offre reste fermée ; une nouvelle offre, elle, s'affiche (avec le lien d'inscription et son code).
    const vitrine = createMemoryRouter([{ path: "/", element: <OfferBanner scope="vitrine" /> }], { initialEntries: ["/"] });
    const view = () => render(<DataProvider forceMode="demo"><RouterProvider router={vitrine} /></DataProvider>);
    view();
    await waitFor(() => expect(queryClient.getQueryData(["offer-banner", "demo", "vitrine"])).toBeTruthy());
    expect(screen.queryByTestId("offer-banner")).toBeNull();
    cleanup();
    queryClient.clear();
    await getDemoClient().adminCreateOffer({ name: "Noël", code: "NOEL", discountPercent: null, discountCents: 500, plans: [], durationMonths: null, startsAt: null, endsAt: null, maxRedemptions: null, bannerEnabled: true, bannerText: null, active: true });
    view();
    const noel = await screen.findByTestId("offer-banner");
    expect(noel.textContent).toContain("-5 € sur tous les forfaits avec le code NOEL");
    expect(within(noel).getByRole("link", { name: "J'en profite" }).getAttribute("href")).toBe("/inscription?code=NOEL");
    expect(promoCodeFromSearch("?code=noel")).toBe("NOEL");
  });

  it("stockage bloqué : le bandeau s'affiche et se referme sans erreur", async () => {
    await getDemoClient().adminCreateOffer({ name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: [], durationMonths: null, startsAt: null, endsAt: null, maxRedemptions: null, bannerEnabled: true, bannerText: "Offre de printemps", active: true });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqué"); });
    renderRoutes([{ index: true, element: <p>Accueil</p> }], "/");
    const banner = await screen.findByTestId("offer-banner");
    fireEvent.click(within(banner).getByRole("button", { name: "Fermer le bandeau de l'offre" }));
    expect(screen.queryByTestId("offer-banner")).toBeNull();
  });
});

describe("Abonnement : prix remisé et « Ajouter un code promo »", () => {
  it("affiche le prix remisé de l'offre publique, applique un code puis montre l'offre en cours", async () => {
    await getDemoClient().adminCreateOffer({ name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: 3, startsAt: null, endsAt: null, maxRedemptions: null, bannerEnabled: true, bannerText: null, active: true });
    renderRoutes([{ path: "app/settings/billing", element: <Billing /> }], "/app/settings/billing");
    const prices = await screen.findAllByTestId("discounted-price");
    expect(prices).toHaveLength(1);
    expect(prices[0]!.textContent).toMatch(/24,99\s€.*19,99\s€/);
    expect(screen.getByText("pendant 3 mois avec le code PRINTEMPS")).toBeTruthy();

    const card = await screen.findByTestId("promo-card");
    fireEvent.click(within(card).getByRole("button", { name: "Ajouter un code promo" }));
    fireEvent.change(within(card).getByLabelText(/Code promo/), { target: { value: "inconnu" } });
    fireEvent.click(within(card).getByRole("button", { name: "Appliquer" }));
    expect(await within(card).findByText("Code promo inconnu.")).toBeTruthy();
    fireEvent.change(within(card).getByLabelText(/Code promo/), { target: { value: "printemps" } });
    fireEvent.click(within(card).getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(screen.getByTestId("promo-card").textContent).toContain("Votre offre en cours"));
    expect(screen.getByTestId("promo-card").textContent).toContain("encore 3 échéances mensuelles remisées");
    expect(screen.getByText("Votre offre « Printemps »")).toBeTruthy();
  });

  it("démonstration : code à l'inscription, remise à la première échéance après l'essai, facture avec la ligne de remise", async () => {
    let now = new Date("2026-11-15T10:00:00.000Z");
    const client = new DemoClient(new MemoryDemoStorage(), () => now, { offerStore: new MemoryDemoOfferStore() });
    await client.login({ email: "marie@demo.selio.local", password: "demo" });
    await client.adminCreateOffer({ name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: 3, startsAt: null, endsAt: null, maxRedemptions: null, bannerEnabled: false, bannerText: null, active: true });
    const session = await client.register({ email: "nina@exemple.fr", password: "motdepasse-123", displayName: "Nina", orgName: "Boutique Nina", promoCode: "printemps" });
    expect(session.promo).toMatchObject({ applied: true });
    expect(await client.getOrgOffer()).toMatchObject({ code: "PRINTEMPS", monthsRemaining: 3 });
    // Pendant l'essai : carte enregistrée pour Pro, rien n'est débité ni décompté.
    await client.startCheckout("pro");
    expect((await client.getOrgOffer())!.monthsRemaining).toBe(3);
    // Fin de l'essai : première échéance remisée (24,99 € − 20 % = 19,99 €).
    now = new Date("2026-12-01T10:00:00.000Z");
    const invoices = await client.listInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amountCents: 1999 });
    const view = await client.getInvoice(invoices[0]!.id);
    expect(view.lines.map((l) => [l.label, l.amountCents])).toEqual([["Abonnement Selio Pro — mensuel", 2499], ["Remise : Printemps (PRINTEMPS)", -500]]);
    expect(view.totals).toMatchObject({ inclVatCents: 1999 });
    expect((await client.getOrgOffer())!.monthsRemaining).toBe(2);
    // Une seule offre à la fois ; un code inconnu à l'inscription n'est jamais bloquant.
    await expect(client.applyPromoCode({ code: "PRINTEMPS" })).rejects.toMatchObject({ status: 409 });
    const unknown = await client.register({ email: "leo@exemple.fr", password: "motdepasse-123", displayName: "Léo", orgName: "Boutique Léo", promoCode: "NIMPORTE" });
    expect(unknown.promo).toMatchObject({ applied: false, reason: "unknown_code" });
    expect(unknown.promo!.message).toMatch(/inscription continue/);
  });
});
