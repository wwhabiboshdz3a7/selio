import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { DECLARATION_THRESHOLDS_2026 } from "@selio/contracts";
import { THRESHOLD_DISCLAIMER, thresholdStatus } from "@selio/domain";
import { ListingChecks, ThresholdsBanner } from "./selling";

afterEach(cleanup);

const now = new Date("2026-11-07T12:00:00Z");

describe("bandeau des seuils de déclaration : factuel, sans conseil fiscal", () => {
  it("« approaching » affiché à l'approche d'un seuil, avec la mention et sans injonction", () => {
    const t = { ...thresholdStatus({ salesThisYear: 26, revenueThisYearCents: 90_000, thresholds: { ...DECLARATION_THRESHOLDS_2026 }, now }), enabled: true };
    expect(t.level).toBe("approaching");
    render(<ThresholdsBanner t={t} />);
    const banner = screen.getByRole("region", { name: "Seuils de déclaration" });
    expect(within(banner).getByText("Seuil proche")).toBeTruthy();
    expect(within(banner).getByRole("progressbar", { name: "Ventes de l'année face au seuil" }).getAttribute("aria-valuenow")).toBe("26");
    expect(banner.textContent).toContain("il reste 4 ventes");
    expect(banner.textContent).toContain(THRESHOLD_DISCLAIMER);
    expect(banner.textContent).toContain("renseignez-vous auprès de l'administration");
    expect(banner.textContent).not.toMatch(/vous devez|il faut|déclarez|impôt/i);
  });

  it("« reached » et « none » ; désactivé dans les réglages : rien n'est affiché", () => {
    const reached = { ...thresholdStatus({ salesThisYear: 31, revenueThisYearCents: 50_000, now }), enabled: true };
    const { unmount } = render(<ThresholdsBanner t={reached} />);
    expect(screen.getByText("Seuil atteint")).toBeTruthy();
    unmount();
    const none = { ...thresholdStatus({ salesThisYear: 2, revenueThisYearCents: 5_000, now }), enabled: true };
    const r2 = render(<ThresholdsBanner t={none} />);
    expect(screen.getByText("En dessous des seuils")).toBeTruthy();
    r2.unmount();
    const { container } = render(<ThresholdsBanner t={{ ...none, enabled: false }} />);
    expect(container.textContent).toBe("");
  });
});

describe("contrôle de l'annonce : photos floues et mesures manquantes en avertissements", () => {
  const photos = [1, 2, 3].map((i) => ({ id: `p${i}`, url: `/p${i}.jpg`, alt: i === 3 ? "étiquette" : `photo ${i}`, position: i - 1 }));
  it("une photo au score bas est signalée floue ; les mesures attendues pour un haut sont demandées", () => {
    render(<MemoryRouter><ListingChecks item={{ title: "Pull marine", category: "women", description: "Très bon état.", photos }} scores={[450, 12, null]} /></MemoryRouter>);
    const box = screen.getByRole("region", { name: "Contrôle de l'annonce" });
    expect(within(box).getByText(/Photo n° 2 floue/)).toBeTruthy();
    expect(within(box).queryByText(/Photo n° 1 floue/)).toBeNull();
    expect(within(box).getByText(/Mesures manquantes/)).toBeTruthy();
    expect(box.textContent).toContain("2/3 photo(s) analysée(s)");
  });
  it("mesures écrites dans la description et photos nettes : rien à signaler", () => {
    render(<MemoryRouter><ListingChecks item={{ title: "Pull marine", category: "women", description: "Aisselles 52 cm, longueur 66 cm, épaules 44 cm, manches 60 cm.", photos }} scores={[450, 380, 300]} /></MemoryRouter>);
    const box = screen.getByRole("region", { name: "Contrôle de l'annonce" });
    expect(within(box).queryByText(/floue/)).toBeNull();
    expect(within(box).queryByText(/Mesures manquantes/)).toBeNull();
    expect(within(box).getByText("Rien à signaler")).toBeTruthy();
  });
});
