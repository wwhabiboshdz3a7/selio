/**
 * Rythme humain du Cloud. Tout est pur : l'horloge (`now`) et l'aléa (`rng`)
 * sont injectés, pour des tests déterministes.
 *
 * - Entre deux actions d'un même compte : 45 s à 180 s (`humanDelayMs`).
 * - Seulement pendant les heures actives (8 h – 23 h, heure de Paris par défaut).
 * - Au plus `hourlyCap` actions par heure (12 par défaut) et `dailyCap` par jour
 *   (`automationActionsPerDay` du plan, compteur d'usage « cloud.action »).
 * - Un décalage de démarrage stable par compte (`startJitterMs`) évite que tous
 *   les comptes agissent à la même minute.
 */

export const HUMAN_DELAY_MIN_MS = 45_000;
export const HUMAN_DELAY_MAX_MS = 180_000;
export const DEFAULT_HOURLY_CAP = 12;
export const DEFAULT_TIMEZONE = "Europe/Paris";
export const DEFAULT_ACTIVE_FROM = 8;
export const DEFAULT_ACTIVE_TO = 23;
/** Fenêtre du décalage de démarrage (4 minutes). */
export const START_JITTER_MAX_MS = 4 * 60_000;

export type Rng = () => number;

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(Math.max(x, 0), 0.999_999_999) : 0.5;
}

/**
 * Délai avant l'action suivante, entre 45 s et 180 s. Moyenne de deux tirages
 * (loi triangulaire) : les délais du milieu sont plus fréquents que les extrêmes.
 */
export function humanDelayMs(rng: Rng = Math.random, min = HUMAN_DELAY_MIN_MS, max = HUMAN_DELAY_MAX_MS): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const u = (clamp01(rng()) + clamp01(rng())) / 2;
  return Math.round(lo + u * (hi - lo));
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    partsCache.set(tz, f);
  }
  return f;
}

/** Date et heure locales dans le fuseau `tz` (heure 0–23). */
export function localParts(date: Date, tz = DEFAULT_TIMEZONE): { day: string; hour: number; minute: number } {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "0";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number.parseInt(get("hour"), 10) % 24, minute: Number.parseInt(get("minute"), 10) };
}

/**
 * Vrai si l'heure locale est dans [from, to[. Une plage qui passe minuit
 * (ex. 22 → 6) est acceptée ; from = to veut dire « jamais ».
 */
export function isActiveHour(date: Date, tz = DEFAULT_TIMEZONE, from = DEFAULT_ACTIVE_FROM, to = DEFAULT_ACTIVE_TO): boolean {
  const { hour } = localParts(date, tz);
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Prochaine heure pleine locale (secondes à zéro) strictement après `date`. */
function nextLocalHour(date: Date, tz: string): Date {
  const { minute } = localParts(date, tz);
  const t = new Date(date.getTime());
  t.setUTCSeconds(0, 0);
  return new Date(t.getTime() + (60 - minute) * 60_000);
}

/**
 * Premier instant ≥ `date` dans les heures actives. Si `nextDay`, le premier
 * instant actif d'un AUTRE jour local que celui de `date`. Cherche sur 72 h.
 */
export function nextActiveAt(date: Date, opts: { tz?: string; from?: number; to?: number; nextDay?: boolean } = {}): Date | null {
  const tz = opts.tz ?? DEFAULT_TIMEZONE;
  const from = opts.from ?? DEFAULT_ACTIVE_FROM;
  const to = opts.to ?? DEFAULT_ACTIVE_TO;
  const today = localParts(date, tz).day;
  const ok = (t: Date) => isActiveHour(t, tz, from, to) && (!opts.nextDay || localParts(t, tz).day !== today);
  if (ok(date)) return date;
  let t = nextLocalHour(date, tz);
  for (let i = 0; i < 72; i++) {
    if (ok(t)) return t;
    t = nextLocalHour(t, tz);
  }
  return null;
}

export type CanActReason = "daily_limit" | "hourly_limit" | "outside_active_hours" | "too_soon";

export interface CanActInput {
  /** Actions du compte dans l'heure glissante. */
  actionsLastHour: number;
  /** Actions comptées aujourd'hui (compteur « cloud.action » de l'organisation ou du compte). */
  actionsToday: number;
  /** Plafond du jour (`automationActionsPerDay` du plan) ; 0 = aucune action. */
  dailyCap: number;
  hourlyCap?: number;
  lastActionAt: Date | null;
  /** Plus ancienne action de l'heure glissante, si connue (calcule la prochaine place libre). */
  oldestActionLastHourAt?: Date | null;
  now: Date;
  /** Délai minimal entre deux actions (45 s par défaut ; le service planifie avec `humanDelayMs`). */
  minGapMs?: number;
  tz?: string;
  activeFrom?: number;
  activeTo?: number;
}

export type CanActResult = { ok: true; reason: null; nextAt: null } | { ok: false; reason: CanActReason; nextAt: Date | null };

/**
 * Décide si une action peut partir maintenant. En cas de refus : la première
 * raison (jour, heure, heures actives, délai) et le premier instant où toutes
 * les contraintes connues peuvent être levées (`null` si aucun dans les 72 h).
 */
export function canAct(input: CanActInput): CanActResult {
  const now = input.now;
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  const from = input.activeFrom ?? DEFAULT_ACTIVE_FROM;
  const to = input.activeTo ?? DEFAULT_ACTIVE_TO;
  const hourlyCap = Math.max(0, Math.floor(input.hourlyCap ?? DEFAULT_HOURLY_CAP));
  const dailyCap = Math.max(0, Math.floor(input.dailyCap));
  const minGapMs = Math.max(0, input.minGapMs ?? HUMAN_DELAY_MIN_MS);

  let reason: CanActReason | null = null;
  let earliest = now.getTime();
  let nextDay = false;
  const fail = (r: CanActReason, at: number | null) => {
    reason ??= r;
    if (at !== null) earliest = Math.max(earliest, at);
  };

  if (input.actionsToday >= dailyCap) {
    fail("daily_limit", null);
    nextDay = true;
  }
  if (input.actionsLastHour >= hourlyCap) {
    const base = input.oldestActionLastHourAt ?? now;
    fail("hourly_limit", base.getTime() + 3_600_000);
  }
  if (!isActiveHour(now, tz, from, to)) fail("outside_active_hours", null);
  if (input.lastActionAt && now.getTime() - input.lastActionAt.getTime() < minGapMs) {
    fail("too_soon", input.lastActionAt.getTime() + minGapMs);
  }

  if (reason === null) return { ok: true, reason: null, nextAt: null };
  if (hourlyCap === 0 || (dailyCap === 0 && reason === "daily_limit")) return { ok: false, reason, nextAt: null };
  const nextAt = nextActiveAt(new Date(earliest), { tz, from, to, nextDay: nextDay && localParts(new Date(earliest), tz).day === localParts(now, tz).day });
  return { ok: false, reason, nextAt };
}

/** FNV-1a 32 bits : répartition stable, sans cryptographie (ce n'est pas un secret). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Décalage de démarrage d'un compte, stable (même compte → même décalage) et
 * réparti sur `maxMs` : les comptes n'agissent pas tous à la même minute quand
 * le planificateur se réveille.
 */
export function startJitterMs(key: string, maxMs = START_JITTER_MAX_MS): number {
  if (maxMs <= 0) return 0;
  return fnv1a(key) % Math.floor(maxMs);
}
