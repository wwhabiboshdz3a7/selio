import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CONSENT_MAX_AGE_DAYS, CONSENT_STORAGE_KEY, TRACKING, __resetConsentMemory, categoriesInUse, getConsent, openConsentPreferences, parseConsent, resetConsent, saveConsent, trackingConfig, type TrackingConfig } from "./consent";
import { GTAG_SRC, META_PIXEL_SRC, __resetTracking, applyConsent, trackConversion, trackPageView } from "./tracking";
import { ConsentBanner } from "./ConsentBanner";

const NONE: TrackingConfig = trackingConfig({});
const ALL: TrackingConfig = trackingConfig({ VITE_GA4_ID: "G-TEST1234", VITE_GOOGLE_ADS_ID: "AW-1234567890", VITE_GOOGLE_ADS_SIGNUP_LABEL: "inscriptionAbc", VITE_GOOGLE_ADS_TRIAL_LABEL: "essaiXyz", VITE_META_PIXEL_ID: "1234567890123" });

/**
 * Document factice : les balises <script> ajoutées y sont comptées, jamais exécutées ni
 * téléchargées (happy-dom téléchargerait un vrai script ajouté au document).
 */
type FakeScript = { src: string; async: boolean; dataset: Record<string, string> };
const added = new WeakMap<Document, FakeScript[]>();
function isolatedDoc(): Document {
  const scripts: FakeScript[] = [];
  const doc = {
    cookie: "",
    querySelector: (sel: string) => scripts.find((s) => sel.includes(`"${s.src}"`)) ?? null,
    createElement: (): FakeScript => ({ src: "", async: false, dataset: {} }),
    head: { appendChild: (s: FakeScript) => scripts.push(s) },
  } as unknown as Document;
  added.set(doc, scripts);
  return doc;
}
const trackingScripts = (doc: Document) => (added.get(doc) ?? []).map((s) => s.src);

function clearGlobals() {
  delete window.gtag;
  delete window.dataLayer;
  delete window.fbq;
  delete window._fbq;
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // stockage indisponible
  }
  __resetConsentMemory();
  __resetTracking();
  clearGlobals();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearGlobals();
});

describe("vitrine › consentement : configuration", () => {
  it("vide par défaut : aucun identifiant, aucune catégorie, donc aucun bandeau", () => {
    expect(NONE).toEqual({ ga4Id: null, adsId: null, adsSignupLabel: null, adsTrialLabel: null, metaPixelId: null });
    expect(categoriesInUse(NONE)).toEqual([]);
    // La configuration du site (variables Vite non renseignées dans les tests) : rien d'actif.
    expect(categoriesInUse(TRACKING)).toEqual([]);
  });

  it("n'accepte que des identifiants publics bien formés (rien d'autre n'est injecté dans une adresse de script)", () => {
    const bad = trackingConfig({ VITE_GA4_ID: "G-1\"><script>", VITE_GOOGLE_ADS_ID: "AW-abc", VITE_META_PIXEL_ID: "12ab", VITE_GOOGLE_ADS_SIGNUP_LABEL: "a/b" });
    expect(bad).toEqual(NONE);
    expect(ALL.ga4Id).toBe("G-TEST1234");
    expect(categoriesInUse(ALL)).toEqual(["mesure", "publicite"]);
    expect(categoriesInUse(trackingConfig({ VITE_META_PIXEL_ID: "1234567890123" }))).toEqual(["publicite"]);
  });

  it("choix mémorisé six mois, puis redemandé ; format inconnu ignoré", () => {
    const now = Date.parse("2026-11-20T10:00:00Z");
    const fresh = JSON.stringify({ v: 1, date: "2026-11-01T10:00:00Z", mesure: true, publicite: false });
    expect(parseConsent(fresh, now)).toMatchObject({ mesure: true, publicite: false });
    const old = JSON.stringify({ v: 1, date: new Date(now - (CONSENT_MAX_AGE_DAYS + 1) * 86_400_000).toISOString(), mesure: true, publicite: true });
    expect(parseConsent(old, now)).toBeNull();
    for (const raw of [null, "", "{", "[]", JSON.stringify({ v: 2, date: "2026-11-01T10:00:00Z", mesure: true, publicite: true }), JSON.stringify({ v: 1, date: "x", mesure: true, publicite: true })]) expect(parseConsent(raw, now)).toBeNull();
  });

  it("stockage indisponible (navigation privée) : le choix vaut pour la visite, sans erreur", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqué");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqué");
    });
    expect(getConsent()).toBeNull();
    expect(() => saveConsent({ mesure: false, publicite: false })).not.toThrow();
    expect(getConsent()).toMatchObject({ mesure: false, publicite: false });
  });

  it("le choix est enregistré sous selio.consentement", () => {
    saveConsent({ mesure: true, publicite: false });
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!)).toMatchObject({ v: 1, mesure: true, publicite: false });
    resetConsent();
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });
});

describe("vitrine › consentement : rien n'est chargé sans accord ni sans identifiant", () => {
  it("sans identifiant : même avec un accord complet, aucun script, aucune file gtag ni fbq", () => {
    const doc = isolatedDoc();
    applyConsent({ v: 1, date: new Date().toISOString(), mesure: true, publicite: true }, NONE, doc);
    expect(trackingScripts(doc)).toEqual([]);
    expect(window.gtag).toBeUndefined();
    expect(window.fbq).toBeUndefined();
  });

  it("avec identifiants mais sans choix, ou après un refus : aucun script", () => {
    const doc = isolatedDoc();
    applyConsent(null, ALL, doc);
    expect(trackingScripts(doc)).toEqual([]);
    const refused = saveConsent({ mesure: false, publicite: false });
    applyConsent(refused, ALL, doc);
    expect(trackingScripts(doc)).toEqual([]);
    expect(window.gtag).toBeUndefined();
    expect(window.fbq).toBeUndefined();
    // Les événements restent muets.
    trackPageView("/tarifs", ALL);
    trackConversion("inscription", ALL);
    expect(window.dataLayer).toBeUndefined();
  });

  it("mesure seule : Google tag avec GA4, jamais Google Ads ni Meta", () => {
    const doc = isolatedDoc();
    const choice = saveConsent({ mesure: true, publicite: false });
    applyConsent(choice, ALL, doc);
    expect(trackingScripts(doc)).toEqual([`${GTAG_SRC}?id=G-TEST1234`]);
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
    expect(calls[0]).toEqual(["consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
    expect(calls.some((c) => c[0] === "config" && c[1] === "G-TEST1234")).toBe(true);
    expect(calls.some((c) => c[0] === "config" && c[1] === "AW-1234567890")).toBe(false);
    expect(window.fbq).toBeUndefined();
    trackConversion("essai_clic", ALL);
    const after = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
    expect(after.some((c) => c[0] === "event" && c[1] === "clic_essai")).toBe(true);
    expect(after.some((c) => c[0] === "event" && c[1] === "conversion")).toBe(false);
  });

  it("tout accepté : Google tag et pixel Meta ; conversions d'inscription et de clic sur l'essai envoyées", () => {
    const doc = isolatedDoc();
    applyConsent(saveConsent({ mesure: true, publicite: true }), ALL, doc);
    expect(trackingScripts(doc)).toEqual([`${GTAG_SRC}?id=G-TEST1234`, META_PIXEL_SRC]);
    trackPageView("/logiciel-vinted", ALL);
    trackPageView("/logiciel-vinted", ALL);
    trackConversion("inscription", ALL);
    trackConversion("essai_clic", ALL);
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
    expect(calls.filter((c) => c[0] === "event" && c[1] === "page_view")).toHaveLength(1);
    expect(calls).toContainEqual(["event", "sign_up", { method: "email" }]);
    expect(calls).toContainEqual(["event", "conversion", { send_to: "AW-1234567890/inscriptionAbc" }]);
    expect(calls).toContainEqual(["event", "conversion", { send_to: "AW-1234567890/essaiXyz" }]);
    const fb = window.fbq!.queue.map((a) => Array.from(a));
    expect(fb).toContainEqual(["init", "1234567890123"]);
    expect(fb).toContainEqual(["track", "PageView"]);
    expect(fb).toContainEqual(["track", "CompleteRegistration"]);
    expect(fb).toContainEqual(["trackCustom", "ClicEssai"]);
  });

  it("retrait de l'accord : consentement Google repassé à « refusé », Meta révoqué, plus aucun événement", () => {
    const doc = isolatedDoc();
    applyConsent(saveConsent({ mesure: true, publicite: true }), ALL, doc);
    applyConsent(saveConsent({ mesure: false, publicite: false }), ALL, doc);
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
    expect(calls).toContainEqual(["consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
    expect(window.fbq!.queue.map((a) => Array.from(a))).toContainEqual(["consent", "revoke"]);
    const before = window.dataLayer!.length;
    const fbBefore = window.fbq!.queue.length;
    trackPageView("/faq", ALL);
    trackConversion("inscription", ALL);
    expect(window.dataLayer!.length).toBe(before);
    expect(window.fbq!.queue.length).toBe(fbBefore);
  });
});

describe("vitrine › bandeau de consentement", () => {
  const renderBanner = (config: TrackingConfig) => render(<MemoryRouter><ConsentBanner config={config} /></MemoryRouter>);

  it("sans identifiant configuré : aucun bandeau ; le lien « Cookies » dit qu'aucun outil n'est actif", () => {
    renderBanner(NONE);
    expect(screen.queryByTestId("consent-banner")).toBeNull();
    act(() => openConsentPreferences());
    expect(screen.getByTestId("consent-none").textContent).toMatch(/Aucun outil de mesure d'audience ni de publicité n'est activé/);
  });

  it("refuser est aussi simple qu'accepter : deux boutons voisins, de même style, sans choix précoché", () => {
    renderBanner(ALL);
    const banner = screen.getByTestId("consent-banner");
    const refuse = screen.getByRole("button", { name: "Tout refuser" });
    const accept = screen.getByRole("button", { name: "Tout accepter" });
    expect(refuse.className).toBe(accept.className);
    expect(banner.textContent).toMatch(/Sans accord, rien n'est chargé/);
    fireEvent.click(refuse);
    expect(getConsent()).toMatchObject({ mesure: false, publicite: false });
    expect(screen.queryByTestId("consent-banner")).toBeNull();
  });

  it("tout accepter : les deux catégories configurées", () => {
    renderBanner(ALL);
    fireEvent.click(screen.getByRole("button", { name: "Tout accepter" }));
    expect(getConsent()).toMatchObject({ mesure: true, publicite: true });
  });

  it("personnaliser : chaque catégorie désactivée par défaut, choix enregistré tel quel", () => {
    renderBanner(ALL);
    fireEvent.click(screen.getByRole("button", { name: "Personnaliser" }));
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    for (const s of switches) expect(s.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(switches[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));
    expect(getConsent()).toMatchObject({ mesure: true, publicite: false });
  });

  it("seule la publicité configurée : la mesure d'audience n'est ni proposée ni enregistrée", () => {
    renderBanner(trackingConfig({ VITE_META_PIXEL_ID: "1234567890123" }));
    expect(screen.getByTestId("consent-banner").textContent).toContain("publicité");
    fireEvent.click(screen.getByRole("button", { name: "Tout accepter" }));
    expect(getConsent()).toMatchObject({ mesure: false, publicite: true });
  });
});
