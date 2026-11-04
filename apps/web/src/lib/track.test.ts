import { afterEach, describe, expect, it, vi } from "vitest";
import { PRICE_MODEL_DEMO_DATA, PRICE_MODEL_NOT_TRAINED, quotasForPlan, type PriceEstimate, type PriceModelStatus } from "@selio/contracts";
import { estimateMethodLabel } from "./radar";
import {
  PHOTO_MAX_SIDE, buildTrackUsage, comparablesWeight, criteriaTags, formatDelayDays, hasPrice, itemPriceFeatures, modelStatusView, normalizeCriteria, quantileCents,
  reducePhoto, roundPrice, scanComponents, targetSize, trackAvailable, trendWindows,
} from "./track";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const usage = (scans = 0, photos = 0, filters = 0) => ({
  period: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-04T12:00:00.000Z" },
  track: {
    scans: { used: scans, quota: 0, percent: 0, warning: false, exceeded: false },
    photoSearches: { used: photos, quota: 0, percent: 0, warning: false, exceeded: false },
    filtersFollowed: { used: filters, quota: 0, percent: 0, warning: false, exceeded: false },
  },
});

describe("Track : offre et quotas", () => {
  it("free et Starter : Track indisponible ; Pro 5 / 10 / 30 et 3 mois ; Agence 25 / 50 / 150, 12 mois et flux des ventes", () => {
    expect(trackAvailable(quotasForPlan("free"))).toBe(false);
    expect(trackAvailable(quotasForPlan("starter"))).toBe(false);
    const starter = buildTrackUsage(usage(), { plan: "starter", quotas: quotasForPlan("starter") }, 0);
    expect(starter).toMatchObject({ available: false, salesFeed: false });
    const pro = buildTrackUsage(usage(10, 3), { plan: "pro", quotas: quotasForPlan("pro") }, 2);
    expect(pro).toMatchObject({ available: true, salesFeed: false, historyMonths: 3 });
    expect(pro.filters).toMatchObject({ used: 2, quota: 5, exceeded: false });
    expect(pro.scans).toMatchObject({ used: 10, quota: 10, exceeded: true });
    expect(pro.photoSearches).toMatchObject({ used: 3, quota: 30 });
    const agence = buildTrackUsage(usage(), { plan: "agence", quotas: quotasForPlan("agence") }, 25);
    expect(agence).toMatchObject({ available: true, salesFeed: true, historyMonths: 12 });
    expect(agence.filters).toMatchObject({ used: 25, quota: 25, exceeded: true });
    expect(agence.scans.quota).toBe(50);
    expect(agence.photoSearches.quota).toBe(150);
    // Sans compte des filtres (null), le compteur général sert de repli.
    expect(buildTrackUsage(usage(0, 0, 4), { plan: "pro", quotas: quotasForPlan("pro") }, null).filters.used).toBe(4);
  });

  it("périodes de tendance bornées à l'historique du plan", () => {
    expect(trendWindows(3)).toEqual([7, 30, 90]);
    expect(trendWindows(1)).toEqual([7, 30]);
    expect(trendWindows(0)).toEqual([]);
  });
});

describe("Track : critères", () => {
  it("deux filtres qui ne diffèrent que par la casse, l'ordre ou des espaces ont les mêmes critères normalisés", () => {
    const a = normalizeCriteria({ brands: ["Levi's", " NIKE"], sizes: ["m", "40"], keywords: ["501 "], categories: ["men", "shoes"] });
    const b = normalizeCriteria({ brands: ["nike", "levi's", "Levi's"], sizes: ["40", "M"], keywords: ["501"], categories: ["shoes", "men"] });
    expect(a).toEqual(b);
    expect(a.brands).toEqual(["levi's", "nike"]);
    expect(a.maxPriceCents).toBe(5000);
    expect(criteriaTags({ brands: ["Nike"], categories: ["shoes"], keywords: ["air"], sizes: ["42"], conditions: ["very_good"] })).toEqual(["Nike", "Chaussures", "« air »", "T. 42", "Très bon état"]);
  });

  it("accents et apostrophes typographiques : mêmes critères que le serveur (même empreinte)", () => {
    expect(normalizeCriteria({ brands: ["Levi’s", "Sézane"], keywords: ["Robe  été"] })).toMatchObject({ brands: ["levi's", "sezane"], keywords: ["robe ete"] });
    expect(normalizeCriteria({ brands: ["LEVI'S"] }).brands).toEqual(normalizeCriteria({ brands: ["Levi`s"] }).brands);
  });
});

describe("Track : scan de niche", () => {
  it("composantes de 0 à 100 et note pondérée 35 / 25 / 20 / 20", () => {
    const r = scanComponents({ sold: 30, active: 10, activeListings: 10, medianDaysToSell: 6, medianResaleCents: 3000, medianBuyCents: 1200 });
    expect(r.components).toEqual({ demand: 75, speed: 80, competition: 83, margin: 100 });
    expect(r.score).toBe(Math.round(0.35 * 75 + 0.25 * 80 + 0.2 * 83 + 0.2 * 100));
    const empty = scanComponents({ sold: 0, active: 0, activeListings: 0, medianDaysToSell: null, medianResaleCents: null, medianBuyCents: null });
    expect(empty.components).toEqual({ demand: 0, speed: 50, competition: 100, margin: 0 });
  });
});

describe("prix : règles partagées", () => {
  it("quantiles, prix psychologique x,90 (1 € au moins) et poids des comparables 0,8 × min(1, n / 12)", () => {
    expect(quantileCents([1000, 2000, 3000, 4000], 0.5)).toBe(2500);
    expect(quantileCents([], 0.5)).toBeNull();
    expect(roundPrice(2412)).toBe(2390);
    expect(roundPrice(2450)).toBe(2490);
    expect(roundPrice(40)).toBe(100);
    expect(comparablesWeight(0)).toBe(0);
    expect(comparablesWeight(6)).toBe(0.4);
    expect(comparablesWeight(12)).toBe(0.8);
    expect(comparablesWeight(40)).toBe(0.8);
  });

  it("caractéristiques d'un article : aucune donnée de personne, photos comptées (30 au plus)", () => {
    const f = itemPriceFeatures({ title: " Jean 501 ", brand: "Levi's", category: "men", size: "W32", condition: "good", attributes: { material: "coton", colors: ["bleu"] }, photos: Array.from({ length: 40 }, (_, i) => ({ id: String(i), url: "x", alt: "", position: i })) } as never);
    expect(f).toEqual({ title: "Jean 501", brand: "Levi's", category: "men", size: "W32", material: "coton", color: "bleu", condition: "good", photoCount: 30 });
  });

  it("délai toujours présenté comme une estimation ; méthode « none » : aucun prix", () => {
    expect(formatDelayDays(null)).toBe("Inconnu");
    expect(formatDelayDays(0.4)).toBe("Moins d'un jour");
    expect(formatDelayDays(1)).toBe("≈ 1 jour");
    expect(formatDelayDays(8.6)).toBe("≈ 9 jours");
    const none = { p25: null, p50: null, p75: null, method: "none", strategies: null } as unknown as PriceEstimate;
    expect(hasPrice(none)).toBe(false);
    expect(hasPrice({ p25: 1000, p50: 1500, p75: 2000, method: "blend", strategies: { fast: 990, standard: 1490, max: 1990 } } as PriceEstimate)).toBe(true);
  });
});

describe("état du modèle de prix : rien n'est présenté comme mesuré sans mesure", () => {
  const base: PriceModelStatus = { trained: true, version: "v1", trainedAt: "2026-11-01T03:00:00.000Z", nReferences: 4200, metrics: null, synthetic: false, label: "Modèle entraîné" };

  it("non entraîné, démonstration, entraîné sans mesure, mesuré", () => {
    expect(modelStatusView(null)).toMatchObject({ label: PRICE_MODEL_NOT_TRAINED, measuredError: null });
    expect(modelStatusView({ ...base, trained: false })).toMatchObject({ label: PRICE_MODEL_NOT_TRAINED, measuredError: null });
    // Démo : même avec des mesures, aucune erreur n'est affichée.
    expect(modelStatusView({ ...base, synthetic: true, metrics: { measured: false, mdape: 0.18 } })).toMatchObject({ label: PRICE_MODEL_DEMO_DATA, measuredError: null, within20: null });
    // Entraîné, mais le test n'est pas une mesure réelle (trop peu de ventes) : « non mesurée ».
    expect(modelStatusView({ ...base, metrics: { measured: false, mdape: null } })).toMatchObject({ tone: "warning", measuredError: null });
    expect(modelStatusView({ ...base, metrics: { measured: true, mdape: 0.21, within20: 0.49, nHoldout: 812 } })).toMatchObject({ tone: "success", measuredError: 0.21, within20: 0.49, testSales: 812 });
  });
});

describe("Radar : méthode d'estimation affichée", () => {
  it("chaque méthode de l'estimation des prix a un libellé et une explication", () => {
    expect(estimateMethodLabel("embeddings").label).toBe("Ventes proches (similarité)");
    expect(estimateMethodLabel("brand_category").label).toBe("Marque et catégorie");
    expect(estimateMethodLabel("model").label).toBe("Modèle de prix");
    expect(estimateMethodLabel("blend").label).toBe("Ventes comparables et modèle de prix");
    // Phrases de l'ancienne estimation (affaires déjà enregistrées, démonstration) : gardées en détail.
    expect(estimateMethodLabel("Médiane des ventes de la marque, ajustée à l'état")).toEqual({ label: "Marque et catégorie", detail: "Médiane des ventes de la marque, ajustée à l'état" });
    expect(estimateMethodLabel("Aucun comparable : multiple prudent du prix observé (×1,6), ajusté à l'état").label).toBe("Estimation prudente");
  });
});

describe("recherche par photo : réduction dans le navigateur", () => {
  it("le plus long côté passe à 1 200 px au plus, proportions gardées, jamais agrandie", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1200, height: 900, scaled: true });
    expect(targetSize(1080, 1920)).toEqual({ width: 675, height: 1200, scaled: true });
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(PHOTO_MAX_SIDE).toBe(1200);
  });

  it("dessine la photo réduite dans un canevas et renvoie un JPEG en data URL", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3024, height: 4032, close })));
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillStyle: "", fillRect: vi.fn(), drawImage: draw } as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,QUJD");
    const out = await reducePhoto(new File(["x"], "pull.jpg", { type: "image/jpeg" }));
    expect(out).toEqual({ dataUrl: "data:image/jpeg;base64,QUJD", width: 900, height: 1200, originalWidth: 3024, originalHeight: 4032 });
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 900, 1200);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.82);
    expect(close).toHaveBeenCalled();
  });

  it("photo illisible : message en clair", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new DOMException("The source image could not be decoded.", "InvalidStateError"); }));
    await expect(reducePhoto(new File(["x"], "photo.heic", { type: "image/heic" }))).rejects.toThrow(/Photo illisible dans ce navigateur/);
  });
});
