import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createProfileDir, removeProfileDir } from "../profile";
import { DEFAULT_VIEWPORT, contextOptions, launchOptions } from "./launch";

/**
 * Vérification de démarrage du Cloud : Chromium se lance-t-il avec le bac à
 * sable demandé ? Le worker l'appelle au démarrage et **désactive le Cloud** si
 * la réponse est non (« refuser de démarrer plutôt que d'agir sans bac à
 * sable »). Une page vide est ouverte puis tout est refermé ; rien ne sort sur
 * le réseau.
 */
export type ChromiumProbeResult =
  | { ok: true; version: string; sandbox: boolean }
  | {
      ok: false;
      /** `sandbox` : Chromium refuse de démarrer avec son bac à sable (root, espaces de noms interdits, seccomp…). */
      reason: "sandbox" | "launch";
      /** Message fixe, sans extrait des journaux de Chromium. */
      message: string;
    };

export interface ChromiumProbeInput {
  chromiumPath: string;
  sandbox: boolean;
  /** Dossier de base des dossiers de travail (CLOUD_PROFILE_DIR). */
  workBaseDir?: string;
  timeoutMs?: number;
  sourceEnv?: Record<string, string | undefined>;
}

const SANDBOX_FAILURE_RE = /sandbox|crbug\.com\/638180|crbug\.com\/357670|no usable sandbox|running as root without --no-sandbox/i;

export const SANDBOX_UNAVAILABLE_MESSAGE =
  "Le bac à sable de Chromium est indisponible sur cette machine (processus lancé en root, espaces de noms utilisateur interdits ou profil seccomp trop strict) : le Cloud reste désactivé. Voir docs/CLOUD.md §7.";

export async function probeChromium(input: ChromiumProbeInput): Promise<ChromiumProbeResult> {
  const workDir = await createProfileDir(input.workBaseDir);
  let browser: Browser | null = null;
  try {
    await mkdir(join(workDir, "artifacts"), { mode: 0o700 });
    browser = await chromium.launch(launchOptions({ chromiumPath: input.chromiumPath, headless: true, timeoutMs: input.timeoutMs ?? 30_000, sandbox: input.sandbox, workDir, sourceEnv: input.sourceEnv }));
    const context = await browser.newContext(contextOptions(DEFAULT_VIEWPORT));
    const page = await context.newPage();
    await page.goto("about:blank");
    return { ok: true, version: browser.version(), sandbox: input.sandbox };
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (input.sandbox && SANDBOX_FAILURE_RE.test(text)) return { ok: false, reason: "sandbox", message: SANDBOX_UNAVAILABLE_MESSAGE };
    return { ok: false, reason: "launch", message: "Chromium n'a pas pu être lancé (CLOUD_CHROMIUM_PATH, bibliothèques système ou mémoire) : le Cloud reste désactivé." };
  } finally {
    await browser?.close().catch(() => {});
    await removeProfileDir(workDir).catch(() => {});
  }
}
