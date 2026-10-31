/** Interface DOM minimale : permet de tester les adaptateurs sur des fixtures sans navigateur complet. */
export interface MinimalElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): MinimalElement | null;
  querySelectorAll(selector: string): ArrayLike<MinimalElement> & Iterable<MinimalElement>;
}

export interface MinimalDocument extends MinimalElement {
  readonly title: string;
}

export function text(el: MinimalElement | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function attr(el: MinimalElement | null | undefined, name: string): string | null {
  const v = el?.getAttribute(name);
  return v === undefined ? null : v;
}

/** Essaie plusieurs sélecteurs dans l'ordre (versionnage souple des adaptateurs). */
export function first(root: MinimalElement, selectors: string[]): MinimalElement | null {
  for (const s of selectors) {
    try {
      const el = root.querySelector(s);
      if (el) return el;
    } catch {
      // sélecteur invalide pour ce moteur : on passe au suivant
    }
  }
  return null;
}

export function all(root: MinimalElement, selectors: string[]): MinimalElement[] {
  for (const s of selectors) {
    try {
      const list = root.querySelectorAll(s);
      if (list.length > 0) return Array.from(list);
    } catch {
      // idem
    }
  }
  return [];
}
