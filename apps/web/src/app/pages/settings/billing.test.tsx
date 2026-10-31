import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider, formatCents } from "@selio/ui";
import { quotasForPlan, type InvoiceView, type Subscription } from "@selio/contracts";
import { PRICING } from "@selio/demo-data";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import type { InvoiceIssuerConfig } from "../../../lib/env";
import { BillingBanner, RequireSession } from "../../layout";
import Billing, { offerAction } from "./Billing";
import { InvoiceSheet } from "./InvoiceDetail";

const NOW = new Date("2026-10-29T12:00:00Z");

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    orgId: "org-1",
    plan: "pro",
    status: "trialing",
    provider: "none",
    externalRef: null,
    currentPeriodEnd: "2026-11-12T12:00:00Z",
    quotas: quotasForPlan("pro"),
    cardOnFile: false,
    cancelAtPeriodEnd: false,
    testMode: true,
    revolutCustomerId: null,
    paymentMethodId: null,
    cycle: "monthly",
    pendingPlan: null,
    chargeAttempts: 0,
    nextChargeAt: null,
    lastChargeError: null,
    dataRetentionUntil: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-28T00:00:00Z",
    ...over,
  };
}
const withCard = { cardOnFile: true, provider: "revolut" as const, paymentMethodId: "pm_123", revolutCustomerId: "cust_123" };

beforeAll(() => {
  // happy-dom ne connaît pas forcément showModal() : on reproduit l'attribut `open` qu'il poserait.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Paramètres › Abonnement : libellé du bouton de chaque offre", () => {
  it("pendant l'essai sans carte : « Enregistrer ma carte » sur chaque offre", () => {
    for (const plan of ["starter", "pro", "agence"] as const) expect(offerAction(sub(), plan, NOW)).toEqual({ kind: "button", label: "Enregistrer ma carte" });
  });

  it("pendant l'essai avec carte : « Choisir cette offre », puis « Offre retenue » pour celle choisie", () => {
    expect(offerAction(sub(withCard), "agence", NOW)).toEqual({ kind: "button", label: "Choisir cette offre" });
    expect(offerAction(sub({ ...withCard, pendingPlan: "agence" }), "agence", NOW)).toEqual({ kind: "pending", label: "Offre retenue" });
    expect(offerAction(sub({ ...withCard, pendingPlan: "agence" }), "pro", NOW)).toEqual({ kind: "button", label: "Choisir cette offre" });
  });

  it("abonnement actif : « Offre actuelle », « Changer d'offre », puis « Au prochain renouvellement »", () => {
    const active = sub({ ...withCard, status: "active", plan: "pro", currentPeriodEnd: "2026-11-29T12:00:00Z" });
    expect(offerAction(active, "pro", NOW)).toEqual({ kind: "current", label: "Offre actuelle" });
    expect(offerAction(active, "agence", NOW)).toEqual({ kind: "button", label: "Changer d'offre" });
    const pending = { ...active, pendingPlan: "agence" as const };
    expect(offerAction(pending, "agence", NOW)).toEqual({ kind: "pending", label: "Au prochain renouvellement" });
    expect(offerAction(pending, "pro", NOW)).toEqual({ kind: "button", label: "Changer d'offre" });
  });

  it("essai terminé, résilié ou accès de base : « Payer » ouvre le formulaire", () => {
    expect(offerAction(sub({ status: "canceled", plan: "free" }), "starter", NOW)).toEqual({ kind: "button", label: "Payer" });
    expect(offerAction(sub({ status: "trialing", currentPeriodEnd: "2026-10-01T00:00:00Z" }), "pro", NOW)).toEqual({ kind: "button", label: "Payer" });
    expect(offerAction(sub({ status: "none", plan: "free" }), "agence", NOW)).toEqual({ kind: "button", label: "Payer" });
  });

  it("en retard de paiement avec carte : l'offre actuelle reste l'offre actuelle, les autres se choisissent au renouvellement", () => {
    const pastDue = sub({ ...withCard, status: "past_due", plan: "starter", nextChargeAt: "2026-10-30T05:00:00Z" });
    expect(offerAction(pastDue, "starter", NOW)).toEqual({ kind: "current", label: "Offre actuelle" });
    expect(offerAction(pastDue, "pro", NOW)).toEqual({ kind: "button", label: "Changer d'offre" });
  });
});

describe("bandeau d'abonnement au-dessus des pages", () => {
  const show = (s: Subscription | null, pathname = "/app") => render(<MemoryRouter><BillingBanner s={s} pathname={pathname} /></MemoryRouter>);

  it("essai sans carte : « Enregistrez votre carte » avec les jours restants et un lien vers l'abonnement", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      show(sub());
      const banner = screen.getByTestId("trial-card-banner");
      expect(banner.textContent).toMatch(/Enregistrez votre carte pour garder l'accès après l'essai/);
      expect(banner.textContent).toMatch(/14 jours restants/);
      expect(banner.textContent).toMatch(/rien n'est débité avant la fin/);
      expect(within(banner).getByRole("link", { name: "Enregistrer ma carte" }).getAttribute("href")).toBe("/app/settings/billing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("déjà sur la page Abonnement : le bandeau reste, sans lien vers lui-même", () => {
    show(sub(), "/app/settings/billing");
    expect(screen.getByTestId("trial-card-banner")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Enregistrer ma carte" })).toBeNull();
  });

  it("paiement échoué : la prochaine tentative est annoncée", () => {
    show(sub({ ...withCard, status: "past_due", nextChargeAt: "2026-10-30T05:00:00Z" }));
    const banner = screen.getByTestId("past-due-banner");
    expect(banner.textContent).toMatch(/Le dernier paiement a échoué/);
    expect(banner.textContent).toMatch(/prochaine tentative le 30\/10\/2026/);
    expect(within(banner).getByRole("link", { name: "Vérifier ma carte" })).toBeTruthy();
  });

  it("rien à dire : essai avec carte, abonnement actif, ou abonnement inconnu", () => {
    const { container: a } = show(sub(withCard));
    expect(a.textContent).toBe("");
    cleanup();
    const { container: b } = show(sub({ ...withCard, status: "active" }));
    expect(b.textContent).toBe("");
    cleanup();
    const { container: c } = show(null);
    expect(c.textContent).toBe("");
  });
});

describe("feuille de facture imprimable", () => {
  const issuer: InvoiceIssuerConfig = { name: "Selio", addressLines: ["Adresse à compléter"], siren: "à compléter", vatNumber: "à compléter", email: "à compléter", missing: ["address", "siren", "vatNumber", "email"] };
  const view = (vatRate: number, vatNotice: string | null): InvoiceView => ({
    invoice: { id: "inv-1", orgId: "org-1", number: "SEL-2026-000001", plan: "pro", cycle: "monthly", amountCents: 2499, vatRate, vatNotice, periodStart: "2026-11-12T12:00:00Z", periodEnd: "2026-12-12T12:00:00Z", orderId: "order_abc", issuedAt: "2026-11-12T12:00:00Z", createdAt: "2026-11-12T12:00:00Z" },
    issuer: { name: "Selio", vatNotice },
    customer: { orgName: "Boutique Marie", email: "marie@exemple.fr" },
    lines: [{ label: "Abonnement Selio Pro — mensuel", periodLabel: "du 12 novembre 2026 au 12 décembre 2026", amountCents: 2499 }],
    totals: vatRate > 0 ? { exclVatCents: 2083, vatCents: 416, inclVatCents: 2499, vatRate } : { exclVatCents: 2499, vatCents: 0, inclVatCents: 2499, vatRate },
    paymentProvider: "revolut",
  });

  it("TVA 20 % : émetteur avec ses mentions « à compléter », client, numéro, désignation, HT, TVA et TTC", () => {
    render(<InvoiceSheet view={view(20, null)} issuer={issuer} />);
    const sheet = screen.getByRole("article");
    expect(within(sheet).getByRole("heading", { name: /Facture SEL-2026-000001/ })).toBeTruthy();
    expect(sheet.textContent).toMatch(/Adresse à compléter/);
    expect(sheet.textContent).toMatch(/SIREN : à compléter/);
    expect(sheet.textContent).toMatch(/Boutique Marie/);
    expect(sheet.textContent).toMatch(/Abonnement Selio Pro — mensuel/);
    expect(within(sheet).getByText("Total HT").nextElementSibling?.textContent).toBe(formatCents(2083));
    expect(within(sheet).getByText("TVA 20 %").nextElementSibling?.textContent).toBe(formatCents(416));
    expect(within(sheet).getByText("Total TTC").nextElementSibling?.textContent).toBe(formatCents(2499));
    expect(sheet.textContent).toMatch(/Carte bancaire via Revolut/);
    expect(sheet.textContent).toMatch(/frais du prestataire de paiement .* ne sont jamais refacturés/);
    expect(sheet.textContent).not.toMatch(/293 B/);
  });

  it("franchise en base : TVA à 0 et mention de l'article 293 B du CGI", () => {
    render(<InvoiceSheet view={view(0, "TVA non applicable, art. 293 B du CGI")} issuer={{ ...issuer, name: "Selio SAS", missing: [] }} />);
    const sheet = screen.getByRole("article");
    expect(sheet.textContent).toMatch(/TVA non applicable, art\. 293 B du CGI/);
    expect(within(sheet).getByText("Total HT").nextElementSibling?.textContent).toBe(formatCents(2499));
    expect(within(sheet).getByText("Total TTC").nextElementSibling?.textContent).toBe(formatCents(2499));
    expect(within(sheet).getByText("TVA", { selector: "dt" }).nextElementSibling?.textContent).toBe(formatCents(0));
    expect(within(sheet).getAllByText("—").length).toBe(1);
    expect(sheet.textContent).toMatch(/Selio SAS/);
  });
});

describe("Paramètres › Abonnement (démonstration)", () => {
  async function mount() {
    const client = getDemoClient();
    await client.resetDemo();
    await client.login({ email: "marie@demo.selio.local", password: "demo" });
    queryClient.clear();
    const router = createMemoryRouter([{ path: "/app/settings/billing", element: <RequireSession><Billing /></RequireSession> }], { initialEntries: ["/app/settings/billing"] });
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Votre offre" })).toBeTruthy();
    return client;
  }

  it("essai avec carte : trois offres à choisir, périodicité mensuelle ou annuelle (2 mois offerts), aucun formulaire en démo", async () => {
    await mount();
    // « 14 jours » est en gras, le reste de la phrase suit : on lit le texte de la page.
    expect(document.body.textContent).toMatch(/jours? d'essai restants?/);
    expect(screen.getByText("Carte enregistrée")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Choisir cette offre" })).toHaveLength(3);
    expect(screen.getByText(/Démonstration : le paiement est simulé/)).toBeTruthy();
    // Carte déjà enregistrée : la périodicité a été fixée avec elle (l'API ne la change pas sans nouveau formulaire).
    expect(screen.queryByRole("radiogroup", { name: "Périodicité" })).toBeNull();
    expect(screen.getByText(/fixée avec la carte enregistrée/)).toBeTruthy();
    // Le texte est normalisé par Testing Library (espace insécable → espace).
    expect(screen.getByText(formatCents(PRICING.monthlyCents.pro).replace(/\s/g, " "), { exact: false })).toBeTruthy();
    expect(screen.getAllByText(/\/ mois/)).toHaveLength(3);
    // Mention de sécurité : le numéro de carte ne passe jamais par Selio.
    expect(screen.getByText(/ne transite jamais par Selio/)).toBeTruthy();
  });

  it("choisir une offre pendant l'essai la retient pour la fin de l'essai (succès immédiat en démo)", async () => {
    const client = await mount();
    const row = screen.getByText("Agence", { selector: "p" }).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Choisir cette offre" }));
    expect(await screen.findByText("Offre retenue")).toBeTruthy();
    expect(screen.getByText(/Offre Agence retenue/)).toBeTruthy();
    expect(await client.getSubscription()).toMatchObject({ pendingPlan: "agence", status: "trialing" });
    expect(screen.getByText(/puis l'offre Agence \(mensuel\) démarre automatiquement/)).toBeTruthy();
  });

  it("résiliation en trois clics (Résilier → date de fin d'accès → Confirmer), puis « Reprendre l'abonnement »", async () => {
    const client = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Résilier" }));
    const dialog = document.querySelector("dialog")!;
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(true));
    expect(within(dialog).getByRole("heading", { name: "Résilier l'abonnement ?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/Votre accès continue jusqu'au .* sans nouveau débit/);
    expect(dialog.textContent).toMatch(/conservées 30 jours/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la résiliation" }));
    // Le titre de l'alerte (et le toast de succès, le temps qu'il reste affiché).
    expect((await screen.findAllByText("Résiliation enregistrée")).length).toBeGreaterThanOrEqual(1);
    expect(await client.getSubscription()).toMatchObject({ cancelAtPeriodEnd: true });
    expect(screen.queryByRole("button", { name: "Résilier" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reprendre l'abonnement" }));
    await waitFor(async () => expect((await client.getSubscription()).cancelAtPeriodEnd).toBe(false));
    expect(await screen.findByRole("button", { name: "Résilier" })).toBeTruthy();
  });

  it("un lien mène aux factures", async () => {
    await mount();
    expect(screen.getByRole("link", { name: /Voir mes factures/ }).getAttribute("href")).toBe("/app/settings/invoices");
  });
});
