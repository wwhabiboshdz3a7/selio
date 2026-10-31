import {
  CATALOG_ADAPTER_VERSION,
  CATALOG_GRID_SELECTORS,
  filterCatalogItems,
  parseCatalogPage,
  type CatalogBlockDetector,
  type CatalogItem,
  type CatalogSearchCriteria,
} from "@selio/connectors/vinted-adapter";
import { BLOCK_MESSAGES, detectBlock, type BlockCode } from "../guard";
import { silentLogger, type CloudLogger, type RunFailureCode, type StorageState } from "../types";
import { isLoginPath } from "../vinted";
import type { PageMeasure } from "./metrics";
import { radarStopFor, type RadarStop } from "./policy";
import type { PageFetcher } from "./types";
import { radarPageKind } from "./urls";

/**
 * Lecture d'une recherche Radar EN DIRECT : la page catalogue Vinted de la recherche, chargée avec
 * la session du compte Achat du client (jamais un compte Perso ou de vente, jamais sans accord Cloud :
 * c'est au cœur de le vérifier avant d'appeler), lue puis refermée. Aucune action sur la page.
 *
 * Le lecteur ne décide de rien d'autre que du sens de la page :
 * - `ok` : annonces lues (filtrées localement par les critères qui ne passent pas dans l'adresse) ;
 * - `blocked` : CAPTCHA, avertissement, blocage ou « trop de requêtes » → `stop` dit quoi faire
 *   (pause du compte, alerte, mesure, coupe-circuit pour « trop de requêtes » et blocage). Rien n'est
 *   retenté, aucune tentative de contournement ;
 * - `not_logged_in` : la session du compte Achat n'est plus reconnue (reconnexion par le client) ;
 * - `page_changed` : page non reconnue (adaptateur à revoir, ou vérification que le détecteur ne connaît
 *   pas), rien n'est inventé ; le cœur arrête la recherche après plusieurs lectures anormales de suite ;
 * - `timeout`, `unavailable`, `error` : rien de lu (`unavailable` : aucun navigateur lancé). Un statut
 *   5xx est une `error` lancée (anormale pour le cœur) ; un en-tête de vérification (`cf-mitigated:
 *   challenge`) est un CAPTCHA, quel que soit le statut.
 *
 * `measure` dit comment compter la page dans le taux de blocage (fenêtre glissante) : `blocked`,
 * `ok`, ou `null` quand aucune page n'a été reçue (elle ne compte pas).
 */

export type RadarReadOutcome = "ok" | "blocked" | "not_logged_in" | "page_changed" | "timeout" | "unavailable" | "error";

export interface RadarBlock {
  code: BlockCode;
  /** Motif reconnu (diagnostic, aucune donnée de la page). */
  pattern: string;
  message: string;
}

export interface ReadSearchInput {
  /** Session filtrée du compte Achat, déchiffrée par l'appelant. */
  session: StorageState | null;
  /** Page catalogue (`buildSearchUrl` de l'adaptateur). */
  url: string;
  /** Budget de la lecture, navigateur compris (borné par l'exécuteur). */
  pageBudgetMs?: number;
  /** Critères filtrés après lecture (marques, tailles, états, prix : voir `buildSearchUrl`). */
  criteria?: CatalogSearchCriteria;
  /** Dossier de travail fourni par l'appelant (sinon créé par l'exécuteur). */
  profileDir?: string;
}

export interface RadarReadResult {
  outcome: RadarReadOutcome;
  /** Annonces retenues (après le filtre local des critères), plus récentes d'abord. */
  items: CatalogItem[];
  /** Annonces lisibles sur la page, avant le filtre local. */
  seenCount: number;
  blocked: RadarBlock | null;
  /** Conduite imposée par un signal de Vinted (`blocked` seulement). */
  stop: RadarStop | null;
  /** Comptage de la page dans le taux de blocage ; `null` : aucune page reçue, rien à compter. */
  measure: PageMeasure | null;
  pageOk: boolean;
  durationMs: number;
  finalUrl: string | null;
  status: number | null;
  /** Faux : aucun navigateur lancé (refus, aucun créneau) — rien n'a touché Vinted. */
  launched: boolean;
  /** Instant de la lecture (détection) : base du délai publication → détection. */
  observedAt: string;
  message: string;
  missing: string[];
  warnings: string[];
  adapterVersion: string;
  /** Session relue et filtrée (à rechiffrer par l'appelant si elle a changé). */
  session?: StorageState;
}

export interface RadarReaderOptions {
  fetcher: PageFetcher;
  now?: () => Date;
  logger?: CloudLogger;
  /** Budget par défaut d'une lecture (RADAR_PAGE_BUDGET_MS). */
  pageBudgetMs?: number;
  /** Annonces lues au plus par page. */
  maxItems?: number;
}

const FAILURE_OUTCOME: Partial<Record<RunFailureCode, RadarReadOutcome>> = {
  not_logged_in: "not_logged_in",
  timeout: "timeout",
  unavailable: "unavailable",
  selector_missing: "page_changed",
};

/** Détecteur de `@selio/cloud` pour l'adaptateur catalogue (page publique : aucun motif « membre »). */
export const radarBlockDetector: CatalogBlockDetector = (html, url, o) => {
  const s = detectBlock(html, url, { status: o.status, expectMember: false });
  return s ? { code: s.code, pattern: s.pattern } : null;
};

export class RadarReader {
  private readonly fetcher: PageFetcher;
  private readonly now: () => Date;
  private readonly logger: CloudLogger;
  private readonly pageBudgetMs: number | undefined;
  private readonly maxItems: number | undefined;

  constructor(options: RadarReaderOptions) {
    this.fetcher = options.fetcher;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? silentLogger;
    this.pageBudgetMs = options.pageBudgetMs;
    this.maxItems = options.maxItems;
  }

  async readSearch(input: ReadSearchInput): Promise<RadarReadResult> {
    const base = (over: Partial<RadarReadResult> & Pick<RadarReadResult, "outcome" | "message">): RadarReadResult => ({
      items: [],
      seenCount: 0,
      blocked: null,
      stop: null,
      measure: null,
      pageOk: false,
      durationMs: 0,
      finalUrl: null,
      status: null,
      launched: false,
      observedAt: this.now().toISOString(),
      missing: [],
      warnings: [],
      adapterVersion: CATALOG_ADAPTER_VERSION,
      ...over,
    });

    let path = "";
    try {
      path = new URL(input.url).pathname;
    } catch {
      // adresse illisible : refusée ci-dessous
    }
    if (radarPageKind(path) !== "catalog") return base({ outcome: "error", message: "Adresse refusée : Radar ne lit que des pages catalogue Vinted." });

    const fetched = await this.fetcher.fetchPage({
      session: input.session,
      url: input.url,
      timeoutMs: input.pageBudgetMs ?? this.pageBudgetMs,
      waitForSelectors: CATALOG_GRID_SELECTORS,
      ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    });
    const observedAt = this.now();
    const common = { durationMs: fetched.durationMs, observedAt: observedAt.toISOString(), ...(fetched.session ? { session: fetched.session } : {}) };

    if (!fetched.ok) {
      const stop = radarStopFor(fetched.code);
      if (stop) {
        this.logger.warn("radar.read.stopped", { code: stop.code });
        return base({
          ...common,
          outcome: "blocked",
          blocked: { code: stop.code, pattern: `runner.${stop.code}`, message: stop.message },
          stop,
          measure: fetched.launched ? "blocked" : null,
          launched: fetched.launched,
          message: stop.message,
        });
      }
      return base({ ...common, outcome: FAILURE_OUTCOME[fetched.code] ?? "error", launched: fetched.launched, message: fetched.message });
    }

    const page = { ...common, launched: true, finalUrl: fetched.finalUrl, status: fetched.status };
    if (fetched.challenge) {
      // Vérification anti-robot signalée par l'en-tête de la réponse : arrêt, comme un CAPTCHA dans la page.
      const stop = radarStopFor("captcha")!;
      this.logger.warn("radar.read.stopped", { code: stop.code, pattern: "captcha.header.cf-mitigated" });
      return base({ ...page, outcome: "blocked", blocked: { code: stop.code, pattern: "captcha.header.cf-mitigated", message: stop.message }, stop, measure: "blocked", message: stop.message });
    }
    const parsed = parseCatalogPage(fetched.html, { now: observedAt, url: fetched.finalUrl, status: fetched.status, detectBlock: radarBlockDetector, maxItems: this.maxItems });

    if (parsed.blocked) {
      const stop = radarStopFor(parsed.blocked.code);
      if (stop) {
        this.logger.warn("radar.read.stopped", { code: stop.code, pattern: parsed.blocked.pattern });
        return base({ ...page, outcome: "blocked", blocked: { code: stop.code, pattern: parsed.blocked.pattern, message: stop.message }, stop, measure: "blocked", message: stop.message });
      }
    }
    if (parsed.blocked?.code === "not_logged_in" || isLoginPath(safePath(fetched.finalUrl))) {
      return base({ ...page, outcome: "not_logged_in", measure: "ok", message: BLOCK_MESSAGES.not_logged_in });
    }
    if (fetched.status !== null && fetched.status >= 400) {
      // Erreur de Vinted qui n'est pas un signal de blocage (404, 500…) : rien de lu, la page ne compte pas.
      return base({ ...page, outcome: "error", message: `Vinted a répondu avec le statut ${fetched.status}.`, warnings: parsed.warnings });
    }
    if (!parsed.pageOk) {
      this.logger.warn("radar.read.page_changed", { missing: parsed.missing.join(",") });
      return base({
        ...page,
        outcome: "page_changed",
        measure: "ok",
        missing: parsed.missing,
        warnings: parsed.warnings,
        message: "Page de recherche non reconnue : la page de Vinted a changé (adaptateur à revoir). Rien n'est inventé.",
      });
    }
    const items = input.criteria ? filterCatalogItems(parsed.items, input.criteria) : parsed.items;
    return base({
      ...page,
      outcome: "ok",
      items,
      seenCount: parsed.items.length,
      pageOk: true,
      measure: "ok",
      warnings: parsed.warnings,
      message: `${parsed.items.length} annonce(s) lue(s), ${items.length} retenue(s).`,
    });
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
