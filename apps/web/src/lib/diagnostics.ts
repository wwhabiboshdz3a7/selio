import { appVersion, buildId } from "./env";

/**
 * Diagnostic côté navigateur : garde les dernières erreurs non interceptées et
 * construit un rapport copiable (aucun envoi réseau, rien ne quitte l'appareil).
 */

interface CapturedError {
  at: string;
  kind: "error" | "rejection";
  message: string;
  stack?: string;
}

const MAX = 6;
const recent: CapturedError[] = [];
const RELOAD_FLAG = "selio.reloaded-for-update";

function push(e: CapturedError): void {
  recent.push(e);
  if (recent.length > MAX) recent.shift();
}

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack };
  try {
    return { message: typeof value === "string" ? value : JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

/** Fichier de code introuvable : typiquement une ancienne version encore ouverte après un déploiement. */
export function isStaleBuildError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk \d+ failed|is not a valid JavaScript MIME type/i.test(msg);
}

/** Recharge une seule fois par session pour récupérer la nouvelle version (évite toute boucle). */
export function reloadOnceForUpdate(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function installDiagnostics(): void {
  window.addEventListener("error", (e) => push({ at: new Date().toISOString(), kind: "error", ...describe(e.error ?? e.message) }));
  window.addEventListener("unhandledrejection", (e) => push({ at: new Date().toISOString(), kind: "rejection", ...describe(e.reason) }));
  // Vite émet cet événement quand un fichier de code ne peut plus être chargé (version périmée).
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadOnceForUpdate()) e.preventDefault();
  });
  // Une fois l'application chargée sans erreur, on autorise un futur rechargement automatique.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      // stockage indisponible
    }
  }, 10_000);
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const pick = (re: RegExp, name: string) => {
    const m = ua.match(re);
    return m ? `${name} ${m[1]}` : null;
  };
  return pick(/Edg\/([\d.]+)/, "Edge") ?? pick(/Firefox\/([\d.]+)/, "Firefox") ?? pick(/CriOS\/([\d.]+)/, "Chrome iOS") ?? pick(/Chrome\/([\d.]+)/, "Chrome") ?? pick(/Version\/([\d.]+).*Safari/, "Safari") ?? "Navigateur inconnu";
}

export function errorReport(err: unknown): string {
  const main = describe(err);
  const lines = [
    "Rapport d'erreur Selio",
    `Date : ${new Date().toISOString()}`,
    `Page : ${window.location.pathname}${window.location.search}`,
    `Version : ${appVersion} (build ${buildId})`,
    `Navigateur : ${browserLabel()}`,
    `Agent : ${navigator.userAgent}`,
    `Écran : ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    `Thème : ${document.documentElement.getAttribute("data-theme") ?? "système"}`,
    `Hors ligne (service worker) : ${"serviceWorker" in navigator && navigator.serviceWorker.controller ? "actif" : "inactif"}`,
    "",
    `Erreur : ${main.message}`,
    ...(main.stack ? ["Pile :", ...main.stack.split("\n").slice(0, 12)] : []),
  ];
  const others = recent.filter((r) => r.message !== main.message);
  if (others.length) {
    lines.push("", "Erreurs récentes :");
    for (const r of others) lines.push(`- [${r.at}] ${r.kind} ${r.message}`);
  }
  return lines.join("\n");
}
