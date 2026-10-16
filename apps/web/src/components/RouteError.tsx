import { useEffect, useState } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "@selio/ui";
import { DEMO_STORAGE_KEY } from "@selio/demo-data";
import { errorReport, isStaleBuildError, reloadOnceForUpdate } from "../lib/diagnostics";

/**
 * Écran d'erreur des routes. `inline` : affiché dans la page (le menu reste
 * utilisable) ; sinon plein écran. Le rapport technique se copie en un clic.
 */
export function RouteError({ inline = false }: { inline?: boolean }) {
  const err = useRouteError();
  const is404 = isRouteErrorResponse(err) && err.status === 404;
  const stale = isStaleBuildError(err);
  const [reloading, setReloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const inApp = typeof window !== "undefined" && window.location.pathname.startsWith("/app");
  const report = is404 ? "" : errorReport(err);

  useEffect(() => {
    if (stale && reloadOnceForUpdate()) setReloading(true);
  }, [stale]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const resetDemo = () => {
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      for (const k of Object.keys(localStorage)) if (k.startsWith("selio.dashboard.")) localStorage.removeItem(k);
    } catch {
      // stockage indisponible
    }
    window.location.assign("/app");
  };

  const title = is404 ? "Page introuvable" : stale ? "Nouvelle version disponible" : "Cette page a rencontré un problème";
  const lead = is404
    ? "L'adresse demandée n'existe pas."
    : stale
      ? reloading ? "Chargement de la dernière version…" : "Selio a été mis à jour pendant que la page était ouverte. Rechargez pour utiliser la nouvelle version."
      : "Le reste de l'application fonctionne. Rechargez la page ; si le problème revient, copiez le rapport et envoyez-le-nous.";

  return (
    <div className={inline ? "mx-auto flex max-w-xl flex-col items-center py-16 text-center" : "mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center"} role="alert">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{is404 ? "404" : "Erreur"}</p>
      <h1 className="mt-2 text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-text-muted">{lead}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {!is404 ? <Button onClick={() => window.location.reload()} loading={reloading}>Recharger</Button> : null}
        <Link to={inApp ? "/app" : "/"}><Button variant="secondary">{inApp ? "Vue d'ensemble" : "Accueil"}</Button></Link>
        {!is404 && !stale ? <Button variant="ghost" onClick={copy}>{copied ? "Rapport copié" : "Copier le rapport"}</Button> : null}
      </div>
      {!is404 && !stale ? (
        <details className="mt-6 w-full text-left">
          <summary className="cursor-pointer text-xs font-medium text-text-muted">Détails techniques</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-muted p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-text-muted">{report}</pre>
        </details>
      ) : null}
      {!is404 && !stale && inApp ? (
        <div className="mt-6 text-xs text-text-muted">
          {confirmReset ? (
            <span className="inline-flex flex-wrap items-center justify-center gap-2">Effacer les données de démonstration de cet appareil ?<Button size="sm" variant="secondary" onClick={resetDemo}>Oui, réinitialiser</Button><Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Non</Button></span>
          ) : (
            <button type="button" className="underline underline-offset-2 hover:text-text" onClick={() => setConfirmReset(true)}>Le problème persiste ? Réinitialiser la démonstration</button>
          )}
        </div>
      ) : null}
    </div>
  );
}
