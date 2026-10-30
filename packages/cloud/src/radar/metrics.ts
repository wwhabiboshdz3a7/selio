/**
 * Mesures de Selio Radar (pures, sans horloge ni base) :
 * - délai entre la publication d'une annonce et sa détection, puis entre la détection et l'achat ;
 * - taux de blocage (CAPTCHA, avertissement, blocage, « trop de requêtes ») pour 1 000 pages, sur
 *   une fenêtre glissante des 1 000 dernières pages lues ;
 * - ralentissement automatique : au-delà de 1 blocage pour 1 000 pages, l'intervalle double
 *   (60 → 120 → 240 → 480 s), plafond ×8 ; retour d'un cran par tranche de 24 h sans blocage.
 *
 * Honnêteté des chiffres : une mesure n'existe que si une page a vraiment été lue. Sans échantillon,
 * les résumés rendent `null` et l'interface affiche « à mesurer » (`NOT_MEASURED_LABEL`) ; rien
 * n'est estimé à la place. Une date de publication estimée depuis un texte relatif (« il y a 3 min »)
 * a la précision de ce texte : l'appelant garde `publishedAtSource` à côté du délai.
 */

/** Libellé affiché tant qu'aucune mesure réelle n'existe. */
export const NOT_MEASURED_LABEL = "à mesurer";

/** Intervalles de base : 60 s (Radar), 30 s (3 recherches prioritaires de Radar Auto). */
export const RADAR_BASE_INTERVAL_MS = Object.freeze({ radar: 60_000, auto_priority: 30_000 });
export type RadarReadMode = keyof typeof RADAR_BASE_INTERVAL_MS;

/** Fenêtre glissante : les 1 000 dernières pages lues. */
export const BLOCK_WINDOW_PAGES = 1000;
/** Seuil : au-delà de 1 blocage pour 1 000 pages, l'intervalle double. */
export const BLOCKS_PER_THOUSAND_THRESHOLD = 1;
/** Retour d'un cran par tranche de 24 h sans blocage. */
export const SLOWDOWN_RECOVERY_HOURS = 24;
/** Plafond du facteur de ralentissement (60 s × 8 = 8 min ; 30 s × 8 = 4 min). */
export const SLOWDOWN_MAX_FACTOR = 8;

// ---------------------------------------------------------------------------
// Délais

type Instant = Date | string | number;

function toMs(v: Instant | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** Écart d'horloge toléré (date de publication un peu « dans le futur ») : ramené à 0. */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Délai `to − from` en millisecondes, ou `null` si l'une des dates manque ou est illisible. Un délai
 * légèrement négatif (horloges décalées, estimation à la minute) vaut 0 ; au-delà de 5 minutes dans
 * le futur, la date est incohérente : `null`.
 */
export function delayMs(from: Instant | null | undefined, to: Instant | null | undefined): number | null {
  const a = toMs(from);
  const b = toMs(to);
  if (a === null || b === null) return null;
  const d = b - a;
  if (d < -CLOCK_SKEW_MS) return null;
  return Math.max(0, d);
}

/** Délai entre la publication de l'annonce (lue ou estimée) et sa détection par Radar. */
export function detectionDelayMs(publishedAt: Instant | null | undefined, detectedAt: Instant): number | null {
  return delayMs(publishedAt, detectedAt);
}

/** Délai entre la détection et l'achat (confirmation de commande). */
export function purchaseDelayMs(detectedAt: Instant | null | undefined, purchasedAt: Instant): number | null {
  return delayMs(detectedAt, purchasedAt);
}

export interface DelaySummary {
  count: number;
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], p: number): number {
  // Rang le plus proche : une valeur réellement observée, jamais interpolée.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

/** Résumé des délais mesurés ; `null` sans aucun échantillon (« à mesurer »). */
export function summarizeDelays(samples: readonly (number | null | undefined)[]): DelaySummary | null {
  const xs = samples.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  return { count: xs.length, minMs: xs[0]!, p50Ms: percentile(xs, 50), p90Ms: percentile(xs, 90), maxMs: xs[xs.length - 1]! };
}

// ---------------------------------------------------------------------------
// Taux de blocage

/** Issue d'une page lue pour la mesure : `blocked` = CAPTCHA, avertissement, blocage ou « trop de requêtes ». */
export type PageMeasure = "ok" | "blocked";

/**
 * Fenêtre glissante des `capacity` dernières pages lues (1 000 par défaut). Seules les pages
 * réellement reçues y entrent : un délai dépassé ou un navigateur indisponible ne compte pas.
 *
 * Le taux est rapporté aux pages présentes : 1 blocage sur 200 pages = 5 pour 1 000. C'est le choix
 * prudent (une fenêtre encore incomplète ralentit plus tôt, jamais plus tard).
 */
export class BlockRateWindow {
  readonly capacity: number;
  private readonly ring: boolean[] = [];
  private head = 0;
  private blockedCount = 0;

  constructor(capacity: number = BLOCK_WINDOW_PAGES) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /** Reconstruit une fenêtre à partir des mesures enregistrées, de la plus ancienne à la plus récente. */
  static from(measures: Iterable<PageMeasure>, capacity: number = BLOCK_WINDOW_PAGES): BlockRateWindow {
    const w = new BlockRateWindow(capacity);
    for (const m of measures) w.push(m);
    return w;
  }

  push(measure: PageMeasure): this {
    const blocked = measure === "blocked";
    if (this.ring.length < this.capacity) {
      this.ring.push(blocked);
    } else {
      if (this.ring[this.head]) this.blockedCount--;
      this.ring[this.head] = blocked;
      this.head = (this.head + 1) % this.capacity;
    }
    if (blocked) this.blockedCount++;
    return this;
  }

  /** Pages présentes dans la fenêtre. */
  get size(): number {
    return this.ring.length;
  }

  get blocked(): number {
    return this.blockedCount;
  }

  get isFull(): boolean {
    return this.ring.length === this.capacity;
  }

  /** Part des pages bloquées (0 à 1) ; 0 pour une fenêtre vide. */
  rate(): number {
    return this.ring.length === 0 ? 0 : this.blockedCount / this.ring.length;
  }

  /** Blocages pour 1 000 pages ; `null` pour une fenêtre vide (« à mesurer »). */
  blockedPerThousand(): number | null {
    return this.ring.length === 0 ? null : (this.blockedCount * 1000) / this.ring.length;
  }

  /** Mesures de la plus ancienne à la plus récente. */
  toArray(): PageMeasure[] {
    const ordered = this.ring.length < this.capacity ? this.ring : [...this.ring.slice(this.head), ...this.ring.slice(0, this.head)];
    return ordered.map((b) => (b ? "blocked" : "ok"));
  }
}

// ---------------------------------------------------------------------------
// Ralentissement

/** Facteur ramené à une puissance de deux entre 1 et 64 (valeurs absurdes : 1). */
export function normalizeFactor(f: number | null | undefined): number {
  if (typeof f !== "number" || !Number.isFinite(f) || f < 1) return 1;
  let p = 1;
  while (p * 2 <= Math.min(f, 64)) p *= 2;
  return p;
}

/**
 * Facteur imposé par le taux seul : 1 jusqu'au seuil compris, ×2 au-delà, ×4 au-delà du double du
 * seuil, ×8 au-delà du quadruple (plafond). Un taux inconnu (`null`) ne ralentit pas.
 */
export function rateFactor(blockedPerThousand: number | null, threshold: number = BLOCKS_PER_THOUSAND_THRESHOLD, maxFactor: number = SLOWDOWN_MAX_FACTOR): number {
  const max = normalizeFactor(maxFactor);
  if (blockedPerThousand === null || !(blockedPerThousand > threshold)) return 1;
  let f = 2;
  while (f < max && blockedPerThousand > threshold * f) f *= 2;
  return Math.min(f, max);
}

export interface SlowdownInput {
  /** Taux courant sur la fenêtre glissante (`BlockRateWindow.blockedPerThousand()`). */
  blockedPerThousand: number | null;
  /** Heures écoulées depuis le dernier blocage ; `null` si aucun blocage connu. */
  hoursSinceLastBlock: number | null;
  /** Facteur enregistré au dernier blocage (doublements successifs), s'il y en a un. */
  storedFactor?: number;
  threshold?: number;
  maxFactor?: number;
  recoveryHours?: number;
}

/**
 * Facteur de ralentissement courant : 1, 2, 4 ou 8.
 * - Base : le plus grand du facteur imposé par le taux (`rateFactor`) et du facteur enregistré.
 * - Retour progressif : un cran de moins (÷2) par tranche complète de 24 h sans blocage, jusqu'à 1,
 *   même si la fenêtre des 1 000 dernières pages contient encore l'ancien blocage.
 */
export function slowdownFactor(input: SlowdownInput): number {
  const max = normalizeFactor(input.maxFactor ?? SLOWDOWN_MAX_FACTOR);
  const base = Math.min(max, Math.max(rateFactor(input.blockedPerThousand, input.threshold, max), normalizeFactor(input.storedFactor ?? 1)));
  if (base === 1) return 1;
  const h = input.hoursSinceLastBlock;
  if (h === null || !Number.isFinite(h) || h < 0) return base;
  const recovery = input.recoveryHours ?? SLOWDOWN_RECOVERY_HOURS;
  const steps = recovery > 0 ? Math.floor(h / recovery) : 0;
  return Math.max(1, base / 2 ** Math.min(steps, 10));
}

/**
 * Facteur à enregistrer au moment d'un nouveau blocage : au-delà du seuil (taux calculé AVEC ce
 * blocage), le facteur courant double (60 → 120 → 240 s…), sans descendre sous celui du taux, plafond ×8.
 * Sous le seuil, le facteur courant est gardé.
 */
export function factorAfterBlock(input: { currentFactor: number; blockedPerThousand: number | null; threshold?: number; maxFactor?: number }): number {
  const max = normalizeFactor(input.maxFactor ?? SLOWDOWN_MAX_FACTOR);
  const current = Math.min(max, normalizeFactor(input.currentFactor));
  const threshold = input.threshold ?? BLOCKS_PER_THOUSAND_THRESHOLD;
  if (input.blockedPerThousand === null || !(input.blockedPerThousand > threshold)) return current;
  return Math.min(max, Math.max(current * 2, rateFactor(input.blockedPerThousand, threshold, max)));
}

/** Intervalle entre deux lectures d'une recherche, en millisecondes : 60 s × facteur (Radar) ou 30 s × facteur (prioritaire). */
export function intervalFor(input: { mode: RadarReadMode; factor: number }): number {
  return RADAR_BASE_INTERVAL_MS[input.mode] * normalizeFactor(input.factor);
}
