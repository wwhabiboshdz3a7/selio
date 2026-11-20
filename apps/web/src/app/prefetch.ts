import { matchRoutes, type RouteObject } from "react-router";

/**
 * Préchargement des pages au survol (ou au focus, ou au toucher) des liens du menu : le code de la page
 * est demandé avant le clic, la navigation paraît immédiate. Chaque adresse n'est préchargée qu'une fois ;
 * un échec est ignoré (la navigation réessaiera normalement).
 */
let routes: readonly RouteObject[] = [];
const done = new Set<string>();

export function registerPrefetchRoutes(list: readonly RouteObject[]): void {
  routes = list;
}

export function prefetchRoute(to: string): void {
  const path = to.split(/[?#]/)[0] ?? to;
  if (!path || done.has(path) || routes.length === 0) return;
  done.add(path);
  for (const m of matchRoutes(routes as RouteObject[], path) ?? []) {
    const lazy = m.route.lazy;
    if (typeof lazy === "function") void Promise.resolve().then(() => (lazy as () => unknown)()).catch(() => undefined);
  }
}

/** Propriétés à poser sur un lien pour précharger sa page (souris, clavier, toucher). */
export function prefetchProps(to: string) {
  const go = () => prefetchRoute(to);
  return { onMouseEnter: go, onFocus: go, onTouchStart: go };
}
