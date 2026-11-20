import { getConsent, type ConsentChoice, type TrackingConfig, TRACKING } from "./consent";

/**
 * Chargement de Google tag (Analytics 4, Google Ads) et du pixel Meta, UNIQUEMENT après
 * consentement et seulement si un identifiant est configuré (voir ./consent.ts). Aucun script
 * en ligne : les files d'attente `gtag` et `fbq` sont créées ici, puis les scripts officiels
 * sont ajoutés par une balise `<script src>` (CSP : les hôtes sont listés dans netlify.toml).
 */

type Gtag = (...args: unknown[]) => void;
interface Fbq {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";
export const META_PIXEL_SRC = "https://connect.facebook.net/fr_FR/fbevents.js";

/** Ce qui a été chargé et configuré pendant cette visite. */
const state = { google: false, ga4: false, ads: false, meta: false, metaRevoked: false, lastGa4Path: "", lastMetaPath: "" };

/** Tests : oublie ce qui a été chargé. */
export function __resetTracking(): void {
  state.google = state.ga4 = state.ads = state.meta = state.metaRevoked = false;
  state.lastGa4Path = state.lastMetaPath = "";
}

export function trackingState(): Readonly<typeof state> {
  return state;
}

function addScript(doc: Document, src: string): void {
  if (doc.querySelector(`script[src="${src}"]`)) return;
  const s = doc.createElement("script");
  s.async = true;
  s.src = src;
  s.dataset.selioTracking = "";
  doc.head.appendChild(s);
}

function gtag(...args: unknown[]): void {
  window.gtag?.(...args);
}

function consentModeValues(choice: ConsentChoice | null) {
  const ads = choice?.publicite ? "granted" : "denied";
  return { analytics_storage: choice?.mesure ? "granted" : "denied", ad_storage: ads, ad_user_data: ads, ad_personalization: ads };
}

/** Efface les cookies de mesure et de publicité posés sur ce site (retrait du consentement). */
function clearTrackingCookies(doc: Document): void {
  const names = doc.cookie.split(";").map((c) => c.split("=")[0]!.trim()).filter((n) => /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc)/.test(n));
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = [host, parts.length > 1 ? `.${parts.slice(-2).join(".")}` : host];
  for (const name of names) {
    for (const domain of domains) doc.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
    doc.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

/**
 * Applique le choix du visiteur : charge ce qui est permis et configuré, coupe le reste.
 * Sans identifiant ou sans accord, ne fait strictement rien (aucun script, aucun appel réseau).
 */
export function applyConsent(choice: ConsentChoice | null, cfg: TrackingConfig = TRACKING, doc: Document = document): void {
  const wantGa4 = Boolean(choice?.mesure && cfg.ga4Id);
  const wantAds = Boolean(choice?.publicite && cfg.adsId);
  const wantMeta = Boolean(choice?.publicite && cfg.metaPixelId);

  if ((wantGa4 || wantAds) && !state.google) {
    window.dataLayer = window.dataLayer ?? [];
    // Même forme que l'extrait officiel : `arguments`, et non un tableau.
    window.gtag = function gtagQueue() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    gtag("consent", "default", consentModeValues(choice));
    gtag("js", new Date());
    addScript(doc, `${GTAG_SRC}?id=${encodeURIComponent((wantGa4 ? cfg.ga4Id : cfg.adsId)!)}`);
    state.google = true;
  } else if (state.google) {
    gtag("consent", "update", consentModeValues(choice));
  }
  if (wantGa4 && !state.ga4) {
    // Pages vues envoyées par la vitrine elle-même (application monopage), jamais pour l'application.
    gtag("config", cfg.ga4Id, { send_page_view: false });
    state.ga4 = true;
  }
  if (wantAds && !state.ads) {
    gtag("config", cfg.adsId);
    state.ads = true;
  }

  if (wantMeta && !state.meta) {
    const fbq = function fbqQueue(...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = window.fbq ?? fbq;
    window._fbq = window._fbq ?? window.fbq;
    window.fbq("init", cfg.metaPixelId);
    addScript(doc, META_PIXEL_SRC);
    state.meta = true;
    state.metaRevoked = false;
  } else if (state.meta && wantMeta && state.metaRevoked) {
    window.fbq?.("consent", "grant");
    state.metaRevoked = false;
  } else if (state.meta && !wantMeta && !state.metaRevoked) {
    window.fbq?.("consent", "revoke");
    state.metaRevoked = true;
  }

  if (choice && (!choice.mesure || !choice.publicite) && (state.google || state.meta)) clearTrackingCookies(doc);
}

/** Page vue de la vitrine (application monopage) : seulement si la mesure ou la publicité est active. */
export function trackPageView(path: string, cfg: TrackingConfig = TRACKING): void {
  const choice = getConsent();
  // Une page vue par adresse : un nouveau choix sur la même page ne la recompte pas.
  if (state.ga4 && choice?.mesure && state.lastGa4Path !== path) {
    gtag("event", "page_view", { page_path: path, page_location: `${window.location.origin}${path}`, page_title: document.title });
    state.lastGa4Path = path;
  }
  if (state.meta && choice?.publicite && !state.metaRevoked && cfg.metaPixelId && state.lastMetaPath !== path) {
    window.fbq?.("track", "PageView");
    state.lastMetaPath = path;
  }
}

/** Événements de conversion suivis par la vitrine. */
export type ConversionKind = "inscription" | "essai_clic";

/**
 * Conversion : inscription réussie (compte réel) ou clic sur un appel à l'essai. N'envoie rien
 * sans consentement, sans identifiant ou si les scripts ne sont pas chargés.
 */
export function trackConversion(kind: ConversionKind, cfg: TrackingConfig = TRACKING): void {
  const choice = getConsent();
  if (state.ga4 && choice?.mesure) {
    if (kind === "inscription") gtag("event", "sign_up", { method: "email" });
    else gtag("event", "clic_essai");
  }
  if (state.ads && choice?.publicite && cfg.adsId) {
    const label = kind === "inscription" ? cfg.adsSignupLabel : cfg.adsTrialLabel;
    if (label) gtag("event", "conversion", { send_to: `${cfg.adsId}/${label}` });
  }
  if (state.meta && choice?.publicite && !state.metaRevoked) {
    if (kind === "inscription") window.fbq?.("track", "CompleteRegistration");
    else window.fbq?.("trackCustom", "ClicEssai");
  }
}
