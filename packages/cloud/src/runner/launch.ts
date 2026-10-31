import { join } from "node:path";

/**
 * Options de lancement de Chromium, communes aux actions et à la fenêtre de
 * connexion.
 *
 * Aucune furtivité : pas d'option qui masque l'automatisation
 * (`--disable-blink-features=AutomationControlled`…), pas de User-Agent ni
 * d'empreinte modifiés, `ignoreDefaultArgs` jamais utilisé. La langue et le
 * fuseau sont ceux de la machine (France, Marseille).
 *
 * Isolation :
 * - **bac à sable de Chromium actif** (`chromiumSandbox: true`) : sans lui,
 *   Playwright ajoute `--no-sandbox` et une faille d'un moteur de rendu (pages
 *   de Vinted, de Google, d'Apple…) donnerait accès au processus du worker.
 *   Le désactiver n'est permis qu'en développement (CLOUD_CHROMIUM_SANDBOX=false,
 *   refusé en production par le worker) ;
 * - **environnement minimal en liste blanche** : Chromium ne reçoit jamais
 *   l'environnement du worker (SECRETS_ENCRYPTION_KEY, DATABASE_URL, clés de
 *   paiement…), seulement PATH, la langue, le fuseau, les polices, l'affichage
 *   et des dossiers HOME / TMPDIR / XDG_* pris dans le dossier de travail
 *   temporaire de l'exécution ;
 * - **contexte de navigation sans enregistrement** (`browser.newContext`) :
 *   cookies et stockage local restent en mémoire, jamais écrits sur le disque
 *   (le profil persistant écrivait la session dans une base SQLite du profil).
 */

/**
 * Seuls arguments ajoutés à ceux de Playwright : `/dev/shm` est minuscule dans
 * un conteneur Docker (plantages de Chromium). Avec cet argument, Chromium
 * écrit sa mémoire partagée dans TMPDIR, c'est-à-dire le dossier de travail
 * temporaire de l'exécution (en mémoire vive si CLOUD_PROFILE_DIR est un tmpfs).
 * Rien qui touche à l'empreinte, et jamais `--no-sandbox`.
 */
export const CHROMIUM_ARGS: readonly string[] = Object.freeze(["--disable-dev-shm-usage"]);

export const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 });

/**
 * Variables d'environnement transmises à Chromium si elles existent (aucune
 * n'est secrète). Tout le reste est retiré.
 */
export const CHROMIUM_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "FONTCONFIG_FILE",
  "FONTCONFIG_PATH",
  // Affichage (seulement si CLOUD_HEADLESS=false en développement).
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  // Bac à sable setuid de Chromium, si l'opérateur l'utilise à la place des espaces de noms.
  "CHROME_DEVEL_SANDBOX",
]);

/**
 * Environnement de Chromium : la liste blanche ci-dessus, plus des dossiers
 * personnels pris dans `workDir` (dossier temporaire de l'exécution, supprimé
 * à la fin) pour que rien ne s'écrive dans le vrai HOME du service.
 */
export function chromiumEnv(workDir: string, source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHROMIUM_ENV_ALLOWLIST) {
    const v = source[key];
    if (typeof v === "string" && v.length > 0) env[key] = v;
  }
  env.PATH ??= "/usr/local/bin:/usr/bin:/bin";
  env.HOME = workDir;
  env.TMPDIR = workDir;
  env.XDG_CONFIG_HOME = join(workDir, ".config");
  env.XDG_CACHE_HOME = join(workDir, ".cache");
  env.XDG_DATA_HOME = join(workDir, ".local", "share");
  return env;
}

export interface LaunchInput {
  chromiumPath: string;
  headless: boolean;
  slowMo?: number;
  timeoutMs: number;
  /** Bac à sable de Chromium : vrai sauf exception de développement (CLOUD_CHROMIUM_SANDBOX=false). */
  sandbox: boolean;
  /** Dossier de travail temporaire de l'exécution (HOME, TMPDIR, artefacts de Playwright). */
  workDir: string;
  /** Environnement source filtré par la liste blanche (process.env par défaut ; injecté par les tests). */
  sourceEnv?: Record<string, string | undefined>;
}

/** Ce qui est passé à `chromium.launch` (testé : aucune option de furtivité, bac à sable, environnement minimal). */
export function launchOptions(o: LaunchInput) {
  return {
    executablePath: o.chromiumPath,
    headless: o.headless,
    slowMo: o.slowMo,
    args: [...CHROMIUM_ARGS],
    chromiumSandbox: o.sandbox,
    env: chromiumEnv(o.workDir, o.sourceEnv),
    // Traces, vidéos et téléchargements (aucun n'est utilisé) restent dans le dossier de travail.
    artifactsDir: join(o.workDir, "artifacts"),
    timeout: o.timeoutMs,
    // Le worker gère lui-même l'arrêt : il referme ses navigateurs proprement.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
}

/**
 * Contexte de navigation (`browser.newContext`) : sans enregistrement sur le
 * disque (cookies et stockage local en mémoire, perdus à la fermeture), langue
 * et fuseau de la machine, téléchargements refusés.
 */
export function contextOptions(viewport: { width: number; height: number }) {
  return {
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: viewport.width, height: viewport.height },
    acceptDownloads: false,
  };
}
