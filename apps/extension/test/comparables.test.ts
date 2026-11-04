import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import * as contracts from "@selio/contracts";
import {
  COMPARABLES_FIELDS, COMPARABLES_MESSAGES, CONFIDENCE_LABELS, ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_CONDITION_LABELS, PRICE_CONFIDENCE_LEVELS, PRICE_METHODS, PRICE_METHOD_LABELS,
  PRICE_MODEL_DEMO_DATA, PRICE_NOT_ENOUGH_REFERENCES, PRICE_STRATEGY_LABELS, TRACK_UNAVAILABLE_MESSAGE, buildComparablesRequest, comparablesRequest, comparablesView,
  type ComparablesResponse,
} from "../src/shared/comparables";
import { toBackground } from "../src/shared/messages";
import { comparablesFailure, fetchComparables, isQuietComparablesError } from "../src/background/comparables";
import { ExtApiError } from "../src/shared/api";
import { COMPARABLES_SENT_NOTICE, renderComparables } from "../src/content/comparables-panel";
import { PANEL_CSS, PANEL_RULES, scopeTokens } from "../src/content/panel-css";

/** Article tel que l'adaptateur le lit, AVEC les champs qui ne doivent jamais partir (pseudo, photos…). */
const captured = {
  externalRef: "123456",
  url: "https://www.vinted.fr/items/123456-veste",
  title: "  Veste en jean Levi's   Trucker ",
  brand: "Levi's",
  size: "M / 38 / 10",
  condition: "very_good",
  priceCents: 3500,
  description: "Veste portée deux fois",
  photoUrls: ["https://images.example.invalid/photo-1.jpg"],
  sellerHandle: "vendeur_demo",
};

const estimate: ComparablesResponse = {
  p25: 2800, p50: 3400, p75: 4100, delayDays: 9.4, confidenceLevel: "medium", method: "blend",
  strategies: { fast: 2790, standard: 3390, max: 4090 }, comparableCount: 12, modelVersion: "gbm-2026-11-01", demo: false, message: null,
  priceCheck: { priceCents: 3500, position: "within" },
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function doc(): Document {
  return new Window({ url: "https://www.vinted.fr/items/123456-veste" }).document as unknown as Document;
}

describe("comparables — miroir des contrats", () => {
  it("garde les mêmes listes et libellés que @selio/contracts", () => {
    expect([...ITEM_CATEGORIES]).toEqual([...contracts.ITEM_CATEGORIES]);
    expect([...ITEM_CONDITIONS]).toEqual([...contracts.ITEM_CONDITIONS]);
    expect([...PRICE_METHODS]).toEqual([...contracts.PRICE_METHODS]);
    expect([...PRICE_CONFIDENCE_LEVELS]).toEqual([...contracts.PRICE_CONFIDENCE_LEVELS]);
    expect(PRICE_METHOD_LABELS).toEqual(contracts.PRICE_METHOD_LABELS);
    expect(ITEM_CONDITION_LABELS).toEqual(contracts.ITEM_CONDITION_LABELS);
    expect(PRICE_STRATEGY_LABELS).toEqual(contracts.PRICE_STRATEGY_LABELS);
    expect(PRICE_NOT_ENOUGH_REFERENCES).toBe(contracts.PRICE_NOT_ENOUGH_REFERENCES);
    expect(PRICE_MODEL_DEMO_DATA).toBe(contracts.PRICE_MODEL_DEMO_DATA);
    expect(TRACK_UNAVAILABLE_MESSAGE).toBe(contracts.TRACK_UNAVAILABLE_MESSAGE);
    expect(Object.keys(CONFIDENCE_LABELS).sort()).toEqual([...contracts.PRICE_CONFIDENCE_LEVELS].sort());
  });
  it("accepte une estimation complète de l'API (PriceEstimate + priceCheck)", () => {
    const full = contracts.priceEstimate.parse({ ...estimate, confidence: 0.6, factors: ["12 vente(s) comparable(s)"], explanation: null, explanationSource: null });
    const view = comparablesView({ ok: true, data: { ...full, priceCheck: estimate.priceCheck } });
    expect(view.state).toBe("ready");
  });
});

describe("comparables — message vers le service worker", () => {
  it("n'envoie que titre, marque, catégorie, taille, état et prix", () => {
    const req = buildComparablesRequest(captured);
    expect(Object.keys(req)).toEqual([...COMPARABLES_FIELDS]);
    expect(req).toEqual({ title: "Veste en jean Levi's Trucker", brand: "Levi's", category: null, size: "M / 38 / 10", condition: "very_good", priceCents: 3500 });
    const json = JSON.stringify(req);
    for (const forbidden of ["vendeur_demo", "photo-1", "123456", "portée", "https://"]) expect(json).not.toContain(forbidden);
    expect(toBackground.safeParse({ type: "comparables", item: req }).success).toBe(true);
  });
  it("normalise les valeurs vides ou inconnues (jamais inventées)", () => {
    const req = buildComparablesRequest({ title: "Robe", brand: "  ", size: "", condition: "comme neuf", priceCents: -5, category: "robes" });
    expect(req).toEqual({ title: "Robe", brand: null, category: null, size: null, condition: null, priceCents: null });
    expect(buildComparablesRequest({ title: "Sac", brand: null, size: null, condition: null, priceCents: 1990, category: "bags" }).category).toBe("bags");
  });
  it("refuse toute autre donnée de la page (schéma strict)", () => {
    const req = buildComparablesRequest(captured);
    expect(toBackground.safeParse({ type: "comparables", item: { ...req, sellerHandle: "vendeur_demo" } }).success).toBe(false);
    expect(toBackground.safeParse({ type: "comparables", item: { ...req, photoUrls: [] } }).success).toBe(false);
    expect(toBackground.safeParse({ type: "comparables", item: { ...req, url: captured.url } }).success).toBe(false);
    expect(toBackground.safeParse({ type: "comparables", item: { ...req, title: "" } }).success).toBe(false);
    expect(comparablesRequest.safeParse({ ...req, description: "x" }).success).toBe(false);
  });
});

describe("comparables — service worker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("appelle POST /api/ext/comparables avec le jeton et les seuls champs de l'article", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ...estimate, factors: ["x"], explanation: null }), { status: 200 });
    });
    const out = await fetchComparables("https://api.selio.test/", "tok_".padEnd(30, "x"), buildComparablesRequest(captured));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.selio.test/api/ext/comparables");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${"tok_".padEnd(30, "x")}`);
    expect(Object.keys(JSON.parse(String(calls[0]!.init.body))).sort()).toEqual([...COMPARABLES_FIELDS].sort());
    expect(out.p50).toBe(3400);
    expect("factors" in out).toBe(false);
  });
  it("revalide la demande : une clé de plus ne part jamais", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchComparables("https://api.selio.test", "t".repeat(30), { ...buildComparablesRequest(captured), sellerHandle: "x" } as never)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejette une réponse inattendue", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ p50: "beaucoup" }), { status: 200 }));
    await expect(fetchComparables("https://api.selio.test", "t".repeat(30), buildComparablesRequest(captured))).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("normalise les erreurs : hors ligne, non relié, jeton refusé, Track non compris, trop de demandes", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    const offline = await fetchComparables("https://api.selio.test", "t".repeat(30), buildComparablesRequest(captured)).catch((e: unknown) => e);
    expect(comparablesFailure(offline).code).toBe("offline");
    expect(comparablesFailure(new ExtApiError("unpaired", "x", 401)).code).toBe("unpaired");
    expect(comparablesFailure(new ExtApiError("unauthorized", "Jeton d'extension invalide", 401))).toEqual({ code: "unpaired", message: COMPARABLES_MESSAGES.revoked });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "track_unavailable", message: "Track est compris à partir de Pro" } }), { status: 402 }));
    const starter = await fetchComparables("https://api.selio.test", "t".repeat(30), buildComparablesRequest(captured)).catch((e: unknown) => e);
    expect(comparablesFailure(starter)).toEqual({ code: "track_unavailable", message: TRACK_UNAVAILABLE_MESSAGE });
    expect(isQuietComparablesError(starter as ExtApiError)).toBe(true);
    expect(comparablesFailure(new ExtApiError("rate_limited", "Rate limit exceeded", 429)).code).toBe("rate_limited");
    expect(comparablesFailure(new ExtApiError("forbidden", "Portée « capture:items » absente du jeton.", 403))).toEqual({ code: "forbidden", message: "Portée « capture:items » absente du jeton." });
    expect(isQuietComparablesError(new ExtApiError("forbidden", "x", 403))).toBe(false);
  });
});

describe("comparables — état du panneau", () => {
  it("traduit la réponse du service worker", () => {
    expect(comparablesView({ ok: true, data: estimate }).state).toBe("ready");
    expect(comparablesView({ ok: true, data: { nope: true } })).toEqual({ state: "error", message: COMPARABLES_MESSAGES.invalid });
    expect(comparablesView({ ok: false, code: "offline", message: "x" }).state).toBe("offline");
    expect(comparablesView({ ok: false, code: "unpaired", message: "Extension non reliée" }).state).toBe("unpaired");
    expect(comparablesView({ ok: false, code: "track_unavailable", message: "x" })).toEqual({ state: "track_unavailable", message: TRACK_UNAVAILABLE_MESSAGE });
    expect(comparablesView({ ok: false, code: "rate_limited", message: "x" })).toEqual({ state: "error", message: COMPARABLES_MESSAGES.rateLimited });
    expect(comparablesView({ ok: false, code: "forbidden", message: "Portée absente" })).toEqual({ state: "error", message: "Portée absente" });
  });
});

describe("comparables — affichage", () => {
  it("affiche la fourchette, les trois stratégies, le délai, le nombre de comparables et la méthode", () => {
    const d = doc();
    const s = renderComparables(d, { state: "ready", data: estimate });
    const t = norm(s.textContent);
    expect(s.getAttribute("aria-label")).toBe("Comparables Selio");
    expect(t).toContain("Comparables Selio");
    const cells = [...s.querySelectorAll(".strip > div")].map((c) => [norm(c.querySelector(".k")?.textContent), norm(c.querySelector(".v")?.textContent)]);
    expect(cells).toEqual([["P25", "28,00 €"], ["P50 (médian)", "34,00 €"], ["P75", "41,00 €"]]);
    const rows = Object.fromEntries([...s.querySelectorAll(".row")].map((r) => [norm(r.children[0]?.textContent), norm(r.children[1]?.textContent)]));
    expect(rows["Vente rapide"]).toBe("27,90 €");
    expect(rows["Standard"]).toBe("33,90 €");
    expect(rows["Marge maximale"]).toBe("40,90 €");
    expect(rows["Prix affiché"]).toBe("35,00 € · dans la fourchette");
    expect(rows["Délai de vente estimé"]).toBe("≈ 9 jours");
    expect(t).toContain("12 comparables · Ventes comparables et modèle de prix · confiance moyenne");
    expect(t).toContain("Estimation indicative");
    expect(t).toContain(COMPARABLES_SENT_NOTICE);
    expect(s.querySelector(".badge")?.textContent).toBe("Track");
  });
  it("dit « données de démonstration » et « pas assez de références », sans inventer de prix", () => {
    const d = doc();
    const demo = renderComparables(d, { state: "ready", data: { ...estimate, demo: true, message: "Données de démonstration : le modèle de prix a été entraîné sur le simulateur." } });
    expect(demo.querySelector(".badge")?.textContent).toBe("démonstration");
    expect(norm(demo.textContent)).toContain("Données de démonstration");
    const none = renderComparables(d, { state: "ready", data: { ...estimate, method: "none", p25: null, p50: null, p75: null, strategies: null, comparableCount: 0, delayDays: null, message: PRICE_NOT_ENOUGH_REFERENCES, priceCheck: { priceCents: 3500, position: null } } });
    const t = norm(none.textContent);
    expect(t).toContain(PRICE_NOT_ENOUGH_REFERENCES);
    expect(t).toContain("0 comparable · Pas assez de références");
    expect(t).not.toMatch(/\d+,\d{2} €/);
  });
  it("affiche les états hors ligne (avec Réessayer), non relié et Track non compris", () => {
    const d = doc();
    const onRetry = vi.fn();
    const offline = renderComparables(d, { state: "offline", message: COMPARABLES_MESSAGES.offline }, { onRetry });
    expect(offline.dataset.state).toBe("offline");
    expect(norm(offline.textContent)).toContain("Hors ligne");
    const retry = offline.querySelector("button");
    expect(retry?.textContent).toBe("Réessayer");
    retry!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    const unpaired = renderComparables(d, { state: "unpaired", message: COMPARABLES_MESSAGES.unpaired }, { onRetry });
    expect(norm(unpaired.textContent)).toContain("Extension non reliée à Selio");
    expect(unpaired.querySelector("button")).toBeNull();
    const pro = renderComparables(d, { state: "track_unavailable", message: TRACK_UNAVAILABLE_MESSAGE });
    expect(norm(pro.textContent)).toContain("Track est compris à partir de Pro");
    expect(norm(pro.textContent)).toContain("Pro et Agence");
    const loading = renderComparables(d, { state: "loading" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
  });
  it("rend un message du serveur comme du texte, jamais comme du HTML", () => {
    const d = doc();
    const s = renderComparables(d, { state: "error", message: '<img src=x onerror="alert(1)">' });
    expect(s.querySelector("img")).toBeNull();
    expect(s.textContent).toContain("<img src=x");
  });
});

describe("panneau — charte", () => {
  it("rattache les rôles de tokens.css à l'hôte du shadow DOM", () => {
    const scoped = scopeTokens(':root {\n  --text: #000;\n}\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) { --text: #fff; }\n}\n:root[data-theme="dark"] { --text: #fff; }\n/* ---- Base */\nhtml { color: red; }');
    expect(scoped).not.toContain(":root");
    expect(scoped).not.toContain("html {");
    expect(scoped).toContain(":host {");
    expect(scoped).toContain(':host([data-theme="dark"])');
    expect(PANEL_CSS).toContain("--surface:");
    expect(PANEL_CSS).toContain("--accent:");
  });
  it("n'écrit aucune couleur en dur dans les règles du panneau", () => {
    expect(PANEL_RULES).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(PANEL_RULES).not.toMatch(/rgba?\(/i);
  });
});
