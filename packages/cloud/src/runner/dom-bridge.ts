import type { MinimalDocument, MinimalElement } from "@selio/connectors/vinted-adapter";

/**
 * Pont entre l'adaptateur DOM du connecteur (synchrone : `querySelector`,
 * `getAttribute`, `textContent`) et une page de navigateur pilotée à distance
 * (asynchrone). Il permet de faire tourner `parseConversationPage` de
 * l'adaptateur v1 sur la page vivante, sans recopier un seul sélecteur.
 *
 * Principe « enregistrer puis rejouer » : on exécute la fonction de lecture sur
 * un document mandataire ; chaque question encore sans réponse (sélecteur,
 * attribut) est notée et répond « rien » ; on pose toutes ces questions au
 * navigateur, puis on rejoue. La fonction étant déterministe, on obtient au
 * dernier passage exactement le résultat qu'elle aurait sur la vraie page.
 * Lecture seule : aucun clic, aucune écriture dans la page.
 */

/** Élément distant (poignée Playwright en production, DOM de test sinon). */
export interface DomHandle {
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  /** Lève `InvalidSelectorError` si le moteur refuse le sélecteur. */
  querySelector(selector: string): Promise<DomHandle | null>;
  querySelectorAll(selector: string): Promise<DomHandle[]>;
  dispose?(): Promise<void>;
}

export class InvalidSelectorError extends Error {
  constructor() {
    super("Sélecteur refusé par le moteur de la page.");
    this.name = "InvalidSelectorError";
  }
}

type Answer<T> = { ok: true; value: T } | { ok: false };

interface Snap {
  handle: DomHandle;
  text: string | null;
  attrs: Map<string, string | null>;
  one: Map<string, Answer<Snap | null>>;
  many: Map<string, Answer<Snap[]>>;
}

type Question = { snap: Snap; kind: "attr" | "one" | "many"; key: string };

export interface LiveDomOptions {
  title?: string;
  /** Passages au plus (chaque niveau d'imbrication en coûte un). */
  maxPasses?: number;
}

export class LiveDomIncompleteError extends Error {
  constructor() {
    super("Lecture de la page inachevée (trop de passages).");
    this.name = "LiveDomIncompleteError";
  }
}

/** Exécute `read` (fonction de lecture de l'adaptateur) sur la page derrière `root`. */
export async function readLiveDom<T>(root: DomHandle, read: (doc: MinimalDocument) => T, options: LiveDomOptions = {}): Promise<T> {
  const maxPasses = options.maxPasses ?? 12;
  const created: DomHandle[] = [];
  const snapOf = async (handle: DomHandle, isRoot = false): Promise<Snap> => {
    if (!isRoot) created.push(handle);
    return { handle, text: await handle.textContent(), attrs: new Map(), one: new Map(), many: new Map() };
  };

  try {
    const rootSnap = await snapOf(root, true);
    for (let pass = 0; pass < maxPasses; pass++) {
      // Mandataires et questions propres à ce passage (un mandataire capture `ask`).
      const questions = new Map<string, Question>();
      const proxies = new WeakMap<Snap, MinimalElement>();
      const ids = new WeakMap<Snap, number>();
      let nextId = 0;
      const ask = (snap: Snap, kind: Question["kind"], key: string) => {
        let id = ids.get(snap);
        if (id === undefined) {
          id = nextId++;
          ids.set(snap, id);
        }
        questions.set(`${id}\u0000${kind}\u0000${key}`, { snap, kind, key });
      };
      const proxyOf = (snap: Snap): MinimalElement => {
        const known = proxies.get(snap);
        if (known) return known;
        const el: MinimalElement = {
          get textContent() {
            return snap.text;
          },
          getAttribute(name: string) {
            if (snap.attrs.has(name)) return snap.attrs.get(name) ?? null;
            ask(snap, "attr", name);
            return null;
          },
          querySelector(selector: string) {
            const a = snap.one.get(selector);
            if (!a) {
              ask(snap, "one", selector);
              return null;
            }
            if (!a.ok) throw new InvalidSelectorError();
            return a.value ? proxyOf(a.value) : null;
          },
          querySelectorAll(selector: string) {
            const a = snap.many.get(selector);
            if (!a) {
              ask(snap, "many", selector);
              return [];
            }
            if (!a.ok) throw new InvalidSelectorError();
            return a.value.map(proxyOf);
          },
        };
        proxies.set(snap, el);
        return el;
      };
      const rootProxy = proxyOf(rootSnap);
      const doc: MinimalDocument = Object.assign(Object.create(rootProxy) as MinimalElement, { title: options.title ?? "" });
      const result = read(doc);
      if (questions.size === 0) return result;
      await Promise.all(
        [...questions.values()].map(async ({ snap, kind, key }) => {
          if (kind === "attr") {
            snap.attrs.set(key, await snap.handle.getAttribute(key));
            return;
          }
          try {
            if (kind === "one") {
              const h = await snap.handle.querySelector(key);
              snap.one.set(key, { ok: true, value: h ? await snapOf(h) : null });
            } else {
              const hs = await snap.handle.querySelectorAll(key);
              snap.many.set(key, { ok: true, value: await Promise.all(hs.map((h) => snapOf(h))) });
            }
          } catch (err) {
            if (!(err instanceof InvalidSelectorError)) throw err;
            if (kind === "one") snap.one.set(key, { ok: false });
            else snap.many.set(key, { ok: false });
          }
        }),
      );
    }
    throw new LiveDomIncompleteError();
  } finally {
    await Promise.all(created.map((h) => h.dispose?.().catch(() => {})));
  }
}
