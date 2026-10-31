import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { PLAN_OFFERS, PRICING } from "@selio/demo-data";
import { formatCents, formatNumber } from "@selio/ui";
import Pricing from "./Pricing";

function mockMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

/** Les montants sortent d'Intl (espaces insécables) : on compare avec la même mise en forme. */
const eur = (cents: number) => formatCents(cents);

describe("vitrine › Tarifs", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("essai de 14 jours, trois offres depuis la configuration, annuel, fondateurs, sur devis, montants non définitifs", () => {
    mockMotion();
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("14 jours pour essayer");
    const trial = screen.getByRole("article", { name: "Essai 14 jours" });
    expect(trial.textContent).toContain("carte enregistrée, rien débité avant la fin");
    expect(within(trial).getByRole("link", { name: "Commencer l'essai de 14 jours" }).getAttribute("href")).toBe("/inscription");
    for (const offer of PLAN_OFFERS) {
      const card = screen.getByRole("article", { name: offer.name });
      expect(card.textContent).toContain(eur(offer.indicativeMonthlyCents));
      expect(card.textContent).toContain(offer.profile);
      expect(within(card).getByRole("link", { name: "Commencer par l'essai" }).getAttribute("href")).toBe("/inscription");
    }
    expect(screen.queryByRole("article", { name: "Essentiel" })).toBeNull();
    expect(screen.queryByText(/Découverte/)).toBeNull();
    // Annuel : 2 mois offerts, mensualité équivalente et total à l'année.
    fireEvent.click(screen.getByRole("radio", { name: /À l'année/ }));
    const pro = screen.getByRole("article", { name: "Pro" });
    expect(pro.textContent).toContain(`${eur(PRICING.monthlyCents.pro * PRICING.annualMonthsCharged)} par an`);
    expect(pro.textContent).toContain("2 mois offerts");
    // Les trois mentions sous les offres : annuel, fondateurs, sur devis.
    const terms = screen.getByText("Offre fondateurs").closest("dl")!;
    expect(terms.textContent).toContain("Pour les 50 premiers clients");
    expect(terms.textContent).toContain("−30 % pendant 6 mois sur Pro et Agence");
    expect(terms.textContent).toContain("1 mois offert sur Starter");
    expect(within(terms).getByText("Plus de 10 comptes : sur devis")).toBeTruthy();
    expect(terms.textContent).toContain("Aucun compte supplémentaire à la carte");
    expect(within(terms).getByRole("link", { name: "écrivez-nous" }).getAttribute("href")).toBe("/contact");
    expect(screen.getByText("Montants non définitifs")).toBeTruthy();
  });

  it("les autres filiales : Studio seul au curseur (plancher et minimum), Radar, Radar Auto, Cloud en option, Selio Comptes", () => {
    mockMotion();
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    const studio = screen.getByRole("article", { name: "Selio Studio seul" });
    expect(studio.textContent).toContain(`Plancher ${eur(PRICING.subsidiaries.studio.floorCentsPerPhoto)} la photo`);
    expect(studio.textContent).toContain(`${eur(PRICING.subsidiaries.studio.minPurchaseCents)} minimum par achat`);
    const slider = within(studio).getByRole("slider", { name: "Nombre de photos" }) as HTMLInputElement;
    expect(slider.value).toBe("200");
    expect(studio.textContent).toContain(`${eur(999)} pour ${formatNumber(200)} photos`);
    fireEvent.change(slider, { target: { value: "40" } });
    expect(studio.textContent).toContain(`${eur(499)} pour ${formatNumber(40)} photos`);
    expect(studio.textContent).toContain("minimum par achat appliqué");
    fireEvent.click(within(studio).getByRole("button", { name: new RegExp(`${formatNumber(1200)} photos`) }));
    expect(slider.value).toBe("1200");
    expect(studio.textContent).toContain(`${eur(2999)} pour ${formatNumber(1200)} photos`);
    const rows = screen.getByText("Selio Radar", { exact: true }).closest("ul")!;
    expect(rows.textContent).toContain(eur(PRICING.subsidiaries.radar));
    expect(rows.textContent).toContain(eur(PRICING.subsidiaries.radarAuto));
    expect(rows.textContent).toContain(eur(PRICING.subsidiaries.cloudOption));
    expect(rows.textContent).toContain(eur(PRICING.subsidiaries.comptesAudit));
    expect(rows.textContent).toContain(eur(PRICING.subsidiaries.comptesAccompagnement));
    expect(within(rows).getAllByText("une fois").length).toBe(2);
    expect(within(rows).getAllByText("par mois").length).toBe(3);
  });

  it("comparatif : l'essai et les trois offres, « non inclus » lisible par un lecteur d'écran", () => {
    mockMotion();
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    const table = screen.getByRole("table");
    for (const name of ["Essai 14 jours", "Starter", "Pro", "Agence"]) expect(within(table).getByRole("columnheader", { name: new RegExp(name) })).toBeTruthy();
    const studioRow = within(table).getByRole("row", { name: /Annonces rédigées à partir des photos/ });
    expect(within(studioRow).getAllByText("Non inclus").length).toBe(1);
    expect(studioRow.textContent?.replace(/\s/g, " ")).toContain("20 par mois");
    expect(studioRow.textContent?.replace(/\s/g, " ")).toContain("60 par mois");
  });
});
