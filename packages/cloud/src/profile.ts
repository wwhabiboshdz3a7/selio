import { mkdir, mkdtemp, readdir, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * Dossiers de travail de Chromium. Un dossier par exécution, créé vide (droits
 * 0700), supprimé à la fin. Il sert de HOME, TMPDIR et dossier d'artefacts à
 * Chromium ; les cookies et le stockage local restent en mémoire (contexte sans
 * enregistrement) : la session vit chiffrée en base, jamais dans un fichier.
 */
export const PROFILE_PREFIX = "selio-cloud-";

/** Crée un dossier de profil temporaire neuf (sous le dossier temporaire du système par défaut). */
export async function createProfileDir(baseDir: string = tmpdir()): Promise<string> {
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  return mkdtemp(join(baseDir, PROFILE_PREFIX));
}

export class ProfileDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileDirError";
  }
}

/**
 * Vérifie qu'un dossier de profil peut servir : chemin absolu, inexistant ou
 * vide. Un dossier non vide est refusé (et jamais supprimé) : on ne réutilise
 * pas un profil, et on n'efface pas un dossier qui ne nous appartient pas.
 */
export async function prepareProfileDir(dir: string): Promise<void> {
  if (!dir || !isAbsolute(dir)) throw new ProfileDirError("Le dossier de profil doit être un chemin absolu.");
  let info;
  try {
    info = await stat(dir);
  } catch {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return;
  }
  if (!info.isDirectory()) throw new ProfileDirError("Le dossier de profil n'est pas un dossier.");
  const entries = await readdir(dir);
  if (entries.length > 0) throw new ProfileDirError("Le dossier de profil n'est pas vide : un profil n'est jamais réutilisé.");
}

/** Supprime un dossier de profil (silencieux s'il n'existe plus). */
export async function removeProfileDir(dir: string): Promise<void> {
  if (!dir || !isAbsolute(dir)) return;
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Retire un dossier de profil resté vide (action refusée avant tout lancement).
 * `rmdir` échoue sur un dossier non vide : aucune donnée ne peut être effacée.
 */
export async function discardEmptyProfileDir(dir: string): Promise<void> {
  if (!dir || !isAbsolute(dir)) return;
  await rmdir(dir).catch(() => {});
}

/**
 * Supprime les dossiers oubliés (processus arrêté en pleine action) plus vieux
 * que `olderThanMs`. Le worker l'appelle au démarrage avec 0 (il est seul sur
 * CLOUD_PROFILE_DIR : tout dossier restant vient d'un processus arrêté, quel
 * que soit son âge), puis à chaque passage du Cloud avec la durée de vie
 * maximale d'une action ou d'une fenêtre plus une marge. Renvoie le nombre supprimé.
 */
export async function sweepStaleProfiles(baseDir: string = tmpdir(), olderThanMs = 60 * 60_000, now: Date = new Date()): Promise<number> {
  let names: string[];
  try {
    names = await readdir(baseDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = join(baseDir, name);
    try {
      const info = await stat(dir);
      if (!info.isDirectory() || now.getTime() - info.mtimeMs < olderThanMs) continue;
      await removeProfileDir(dir);
      removed++;
    } catch {
      // dossier disparu entre-temps
    }
  }
  return removed;
}
