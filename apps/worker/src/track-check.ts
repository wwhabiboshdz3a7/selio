import { existsSync, readFileSync } from "node:fs";
import { CATALOG_ADAPTER_VERSION } from "@selio/connectors/vinted-adapter";
import { loadEnv, type WorkerEnv } from "./config";

/**
 * `pnpm track:check` : vérification HORS LIGNE de la configuration de Selio Track avant (et après) le passage à
 * la lecture en direct. Lit les variables (environnement, ou un fichier `.env` passé par `--env-file`), dit
 * ce qui est prêt et ce qui manque. Ne lit JAMAIS de page de Vinted, ne lance aucun navigateur, ne modifie
 * rien. Les valeurs des secrets ne sont jamais affichées : seulement les réglages de Track et du Cloud.
 *
 * Options : `--env-file <chemin>` (ex. deploy/.env sur le PC de production), `--live` (vérifier comme si
 * l'interrupteur était ouvert, pour voir ce qui manquerait), `--db` (lire aussi l'état de Track en base :
 * pause, ralentissement, migration 0021 ; lecture seule, avec DATABASE_URL).
 */

export type TrackCheckLevel = "ok" | "manque" | "attention" | "info" | "manuel";

export interface TrackCheckItem {
  level: TrackCheckLevel;
  label: string;
  detail?: string;
}

export interface TrackCheckReport {
  /** Mode vérifié : celui de la configuration, ou « direct » avec `--live`. */
  mode: "simulateur" | "direct";
  /** Interrupteur tel que configuré (TRACK_LIVE_ENABLED). */
  liveEnabled: boolean;
  items: TrackCheckItem[];
  /** Aucun élément « manque » pour le mode vérifié. */
  ready: boolean;
}

/** Valeurs factices pour les variables sans rapport avec Track (seuls les réglages de Track et du Cloud sont vérifiés). */
const PLACEHOLDERS = { DATABASE_URL: "postgres://verification-hors-ligne", REDIS_URL: "redis://verification-hors-ligne", SECRETS_ENCRYPTION_KEY: "v".repeat(44) };

const truthy = (v: string | undefined) => !!v && /^(1|true|yes|oui|on)$/i.test(v.trim());

/** Fichier `.env` simple (CLE=valeur, commentaires, guillemets). Les valeurs ne sont jamais affichées. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/** Vérifie la configuration de Track (pure : l'existence de Chromium est injectable pour les tests). */
export function checkTrackConfig(env: Record<string, string | undefined>, opts: { forceLive?: boolean; fileExists?: (path: string) => boolean } = {}): TrackCheckReport {
  const items: TrackCheckItem[] = [];
  const fileExists = opts.fileExists ?? existsSync;
  const liveEnabled = truthy(env.TRACK_LIVE_ENABLED);
  const live = liveEnabled || opts.forceLive === true;
  // Seuls les réglages de Track, du Cloud et du plafond de la machine sont lus (les autres sont remplacés par
  // des valeurs factices) : une erreur ailleurs dans la configuration ne masque pas l'état de Track.
  const relevant = Object.fromEntries(Object.entries(env).filter(([k]) => /^(TRACK_|CLOUD_|CRON_TRACK$|RADAR_MAX_PAGES_PER_MINUTE_GLOBAL$|RADAR_PAGE_BUDGET_MS$)/.test(k)));
  let cfg: WorkerEnv | null = null;
  try {
    cfg = loadEnv({ ...PLACEHOLDERS, ...relevant, NODE_ENV: "development" });
  } catch (err) {
    // Message de validation : noms des variables et règle, jamais la valeur d'un secret.
    const lines = (err instanceof Error ? err.message : "Configuration invalide").split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
    items.push({ level: "manque", label: "Réglages de Track ou du Cloud invalides", detail: lines.join(" ; ") || "voir le journal de démarrage du worker" });
  }

  items.push(liveEnabled
    ? { level: "attention", label: "Interrupteur TRACK_LIVE_ENABLED ouvert", detail: "la lecture en direct des pages publiques est demandée : à n'ouvrir qu'avec l'avis écrit de l'avocat" }
    : { level: "info", label: "Interrupteur TRACK_LIVE_ENABLED fermé", detail: "le simulateur est la source (données de démonstration) ; aucune page de Vinted n'est lue" });
  if (truthy(env.TRACK_SELLER_ANALYSIS_ENABLED)) items.push({ level: "manque", label: "TRACK_SELLER_ANALYSIS_ENABLED doit rester à false", detail: "l'analyse d'un vendeur concurrent est refusée (RGPD) et n'est pas construite" });
  else items.push({ level: "ok", label: "Analyse d'un vendeur concurrent fermée (TRACK_SELLER_ANALYSIS_ENABLED=false)" });

  if (live) {
    items.push({ level: "manuel", label: "Avis écrit de l'avocat reçu et rangé dans DECISIONS.md", detail: "lecture des pages publiques, statistiques, base de références, entraînement du modèle de prix" });
    items.push({ level: "manuel", label: `Adaptateur catalogue (${CATALOG_ADAPTER_VERSION}) vérifié à la main sur une vraie page publique`, detail: "construit sur une fixture synthétique : sélecteurs, adresse de recherche, marques, tailles, états, catégories à relever" });
    if (cfg) {
      if (!cfg.CLOUD_ENABLED) items.push({ level: "manque", label: "CLOUD_ENABLED=true", detail: "Track lit avec le lecteur de Selio Cloud ; sans lui, le simulateur reste la source" });
      else items.push({ level: "ok", label: "Selio Cloud activé (CLOUD_ENABLED=true)" });
      if (!cfg.CLOUD_CHROMIUM_PATH) items.push({ level: "manque", label: "CLOUD_CHROMIUM_PATH", detail: "chemin du Chromium installé sur la machine (aucun navigateur n'est téléchargé)" });
      else if (!fileExists(cfg.CLOUD_CHROMIUM_PATH)) items.push({ level: "manque", label: "Chromium introuvable au chemin CLOUD_CHROMIUM_PATH", detail: "vérifier l'installation dans le conteneur du worker (CLOUD.md §7)" });
      else items.push({ level: "ok", label: "Chromium présent (CLOUD_CHROMIUM_PATH)" });
      if (!cfg.CLOUD_CHROMIUM_SANDBOX) items.push({ level: "manque", label: "CLOUD_CHROMIUM_SANDBOX doit rester à true", detail: "Chromium ne tourne jamais sans son bac à sable" });
      if (cfg.TRACK_MAX_PAGES_PER_MINUTE > 2) items.push({ level: "attention", label: `TRACK_MAX_PAGES_PER_MINUTE=${cfg.TRACK_MAX_PAGES_PER_MINUTE}`, detail: "commencer à 2 pages par minute, monter par paliers après une semaine sans blocage" });
      else items.push({ level: "ok", label: `TRACK_MAX_PAGES_PER_MINUTE=${cfg.TRACK_MAX_PAGES_PER_MINUTE} (prudent)` });
      if (cfg.TRACK_READ_INTERVAL_MINUTES < 120) items.push({ level: "attention", label: `TRACK_READ_INTERVAL_MINUTES=${cfg.TRACK_READ_INTERVAL_MINUTES}`, detail: "120 minutes au moins pour commencer" });
      else items.push({ level: "ok", label: `TRACK_READ_INTERVAL_MINUTES=${cfg.TRACK_READ_INTERVAL_MINUTES}` });
      if (cfg.RADAR_MAX_PAGES_PER_MINUTE_GLOBAL < cfg.TRACK_MAX_PAGES_PER_MINUTE) items.push({ level: "attention", label: "RADAR_MAX_PAGES_PER_MINUTE_GLOBAL inférieur au plafond de Track", detail: "le plafond de la machine (partagé avec Radar, prioritaire) limitera Track" });
      items.push({ level: "info", label: `Navigateurs simultanés : CLOUD_MAX_BROWSERS=${cfg.CLOUD_MAX_BROWSERS}`, detail: "partagés avec le Cloud et Radar ; à régler après pnpm cloud:bench" });
      if (cfg.CRON_TRACK !== "*/15 * * * *") items.push({ level: "info", label: `CRON_TRACK=${cfg.CRON_TRACK}`, detail: "15 minutes par défaut" });
    }
  } else if (cfg) {
    items.push({ level: "ok", label: "Rien à préparer pour le simulateur", detail: "lancer avec --live pour voir ce qui manquerait au passage au réel" });
  }
  const ready = !items.some((i) => i.level === "manque");
  return { mode: live ? "direct" : "simulateur", liveEnabled, items, ready };
}

const MARK: Record<TrackCheckLevel, string> = { ok: "[ok]     ", manque: "[MANQUE] ", attention: "[!]      ", info: "[i]      ", manuel: "[à faire]" };

/** Rapport lisible (une ligne par élément). */
export function formatTrackCheck(r: TrackCheckReport): string {
  const head = `Selio Track — vérification hors ligne (mode vérifié : ${r.mode === "direct" ? "lecture en direct" : "simulateur"}) — aucune page de Vinted n'est lue.`;
  const lines = r.items.map((i) => `${MARK[i.level]} ${i.label}${i.detail ? ` — ${i.detail}` : ""}`);
  const tail = r.ready
    ? r.mode === "direct" ? "Configuration complète pour la lecture en direct, sous réserve des points « à faire » (vérifications à la main)." : "Configuration cohérente."
    : "Il manque des éléments : la lecture en direct ne doit pas être ouverte en l'état.";
  return [head, "", ...lines, "", tail].join("\n");
}

/** Ligne de commande : `pnpm track:check [-- --env-file deploy/.env] [--live] [--db]`. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const fileIdx = argv.indexOf("--env-file");
  let env: Record<string, string | undefined> = { ...process.env };
  if (fileIdx >= 0) {
    const path = argv[fileIdx + 1];
    if (!path || !existsSync(path)) {
      console.error(`Fichier introuvable : ${path ?? "(aucun chemin)"}`);
      return 2;
    }
    env = { ...env, ...parseEnvFile(readFileSync(path, "utf8")) };
  }
  const report = checkTrackConfig(env, { forceLive: argv.includes("--live") });
  console.info(formatTrackCheck(report));
  if (argv.includes("--db")) console.info(`\n${await dbState(env)}`);
  return report.ready ? 0 : 1;
}

/** État de Track en base (lecture seule) : pause manuelle, pause après un signal, ralentissement. */
async function dbState(env: Record<string, string | undefined>): Promise<string> {
  if (!env.DATABASE_URL) return "[i]       Base : DATABASE_URL absent, état non lu.";
  const { createPool, repos, Db } = await import("@selio/db");
  const db = new Db(createPool(env.DATABASE_URL, { max: 1 }));
  try {
    const s = await db.withGlobal(async (tx) => ({ runtime: await repos.trackReads.runtime(tx), manual: await repos.trackReads.manualPause(tx) }));
    return [
      `[ok]      Base joignable, migration 0021 appliquée (pause manuelle lisible).`,
      `[i]       Pause manuelle : ${s.manual.paused ? `OUI depuis ${s.manual.since ?? "?"} (${s.manual.reason ?? "sans raison"})` : "non"}.`,
      `[i]       Pause après un signal de Vinted : ${s.runtime.pausedUntil && new Date(s.runtime.pausedUntil).getTime() > Date.now() ? `jusqu'à ${s.runtime.pausedUntil} (${s.runtime.pauseReason})` : "aucune"}.`,
      `[i]       Ralentissement enregistré : ×${s.runtime.slowdownFactor} ; fenêtre ${s.runtime.windowBlocks} blocage(s) sur ${s.runtime.windowReads} lecture(s) en direct.`,
    ].join("\n");
  } catch (err) {
    return `[MANQUE]  Base : état illisible (${err instanceof Error ? err.message.split("\n")[0] : "erreur"}) — migration 0021 appliquée ?`;
  } finally {
    await db.close();
  }
}
