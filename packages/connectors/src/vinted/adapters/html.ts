import type { MinimalDocument, MinimalElement } from "./dom";

/**
 * Lecture d'une page HTML reçue en texte (Selio Cloud lit le HTML d'une page
 * puis referme le navigateur) vers l'interface DOM minimale des adaptateurs,
 * sans navigateur ni dépendance.
 *
 * Volontairement petit et en lecture seule :
 * - tolérant (balises non fermées, fermetures orphelines, éléments vides,
 *   contenu brut de `script`, `style`, `textarea`, `title`) ; les commentaires
 *   et déclarations sont ignorés ; aucune exécution, aucun chargement ;
 * - borné : taille de la page, nombre de nœuds et profondeur limités (une page
 *   hostile ne fait ni exploser la mémoire ni la pile) ;
 * - sélecteurs CSS limités à ce dont les adaptateurs ont besoin : type, `*`,
 *   `#id`, `.classe`, `[attr]`, `[attr=v]`, `[attr^=v]`, `[attr$=v]`,
 *   `[attr*=v]`, `[attr~=v]`, descendant (espace), enfant (`>`), listes (`,`).
 *   Tout autre sélecteur (pseudo-classes, `+`, `~`…) lève une erreur : les
 *   aides `first` / `all` passent alors au sélecteur suivant, comme avec un
 *   moteur qui refuse un sélecteur.
 *
 * Un test vérifie que les adaptateurs donnent le même résultat sur ce document
 * et sur un vrai DOM (happy-dom).
 */

export const HTML_MAX_CHARS = 8_000_000;
export const HTML_MAX_NODES = 300_000;
export const HTML_MAX_DEPTH = 400;

export class HtmlSelectorError extends Error {
  constructor(message = "Sélecteur non pris en charge.") {
    super(message);
    this.name = "HtmlSelectorError";
  }
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Contenu brut : lu tel quel jusqu'à la balise fermante (entités décodées pour les deux derniers). */
const RAW_TEXT = new Set(["script", "style", "xmp", "noembed", "noframes"]);
const RCDATA = new Set(["textarea", "title"]);
const P_CLOSERS = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", laquo: "«", raquo: "»",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", bull: "•", ndash: "–", mdash: "—",
  times: "×", copy: "©", reg: "®", deg: "°", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à",
  acirc: "â", ccedil: "ç", icirc: "î", iuml: "ï", ocirc: "ô", ucirc: "û", ugrave: "ù", Eacute: "É", Agrave: "À",
};

export function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "�";
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

type Child = HtmlElement | string;

/** Élément lu (lecture seule). */
export class HtmlElement implements MinimalElement {
  readonly tagName: string;
  readonly children: Child[] = [];
  parent: HtmlElement | null = null;
  private readonly attrs: Map<string, string>;
  private classes: Set<string> | null = null;
  private text: string | null = null;

  constructor(tagName: string, attrs: Map<string, string> = new Map()) {
    this.tagName = tagName;
    this.attrs = attrs;
  }

  get textContent(): string {
    if (this.text === null) {
      const parts: string[] = [];
      const walk = (el: HtmlElement) => {
        for (const c of el.children) {
          if (typeof c === "string") parts.push(c);
          else walk(c);
        }
      };
      walk(this);
      this.text = parts.join("");
    }
    return this.text;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name.toLowerCase()) ?? null;
  }

  hasClass(name: string): boolean {
    if (!this.classes) this.classes = new Set((this.attrs.get("class") ?? "").split(/\s+/).filter(Boolean));
    return this.classes.has(name);
  }

  querySelector(selector: string): HtmlElement | null {
    const list = compileSelector(selector);
    let found: HtmlElement | null = null;
    this.walkDescendants((el) => {
      if (list.some((complex) => matchesComplex(el, complex, complex.length - 1))) {
        found = el;
        return false;
      }
      return true;
    });
    return found;
  }

  querySelectorAll(selector: string): HtmlElement[] {
    const list = compileSelector(selector);
    const out: HtmlElement[] = [];
    this.walkDescendants((el) => {
      if (list.some((complex) => matchesComplex(el, complex, complex.length - 1))) out.push(el);
      return true;
    });
    return out;
  }

  /** Parcours en ordre du document, sans récursion (profondeur bornée de toute façon). */
  private walkDescendants(visit: (el: HtmlElement) => boolean): void {
    const stack: { el: HtmlElement; i: number }[] = [{ el: this, i: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.i >= top.el.children.length) {
        stack.pop();
        continue;
      }
      const c = top.el.children[top.i++]!;
      if (typeof c === "string") continue;
      if (!visit(c)) return;
      stack.push({ el: c, i: 0 });
    }
  }
}

/** Document lu : la racine, son titre, et l'indication d'une page tronquée par les bornes. */
export class HtmlDocument extends HtmlElement implements MinimalDocument {
  truncated = false;

  constructor() {
    super("#document");
  }

  get title(): string {
    const t = this.querySelector("title");
    return (t?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
}

/** Lit une page HTML (texte) en document minimal. Ne lève jamais. */
export function parseHtmlDocument(input: string): HtmlDocument {
  const doc = new HtmlDocument();
  const html = typeof input === "string" ? input : "";
  if (html.length > HTML_MAX_CHARS) doc.truncated = true;
  const src = html.length > HTML_MAX_CHARS ? html.slice(0, HTML_MAX_CHARS) : html;
  const n = src.length;
  const stack: HtmlElement[] = [doc];
  let nodes = 0;
  const current = () => stack[stack.length - 1]!;
  const append = (child: Child) => {
    const parent = current();
    if (typeof child === "string") {
      const last = parent.children[parent.children.length - 1];
      if (typeof last === "string") parent.children[parent.children.length - 1] = last + child;
      else parent.children.push(child);
      return;
    }
    child.parent = parent;
    parent.children.push(child);
  };
  const closeTo = (name: string): boolean => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k]!.tagName === name) {
        stack.length = k;
        return true;
      }
    }
    return false;
  };

  let i = 0;
  while (i < n) {
    if (nodes > HTML_MAX_NODES) {
      doc.truncated = true;
      break;
    }
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      append(decodeHtmlEntities(src.slice(i)));
      break;
    }
    if (lt > i) {
      append(decodeHtmlEntities(src.slice(i, lt)));
      nodes++;
    }
    i = lt;
    const next = src.charCodeAt(i + 1);
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      const end = src.indexOf(">", i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (next === 47 /* / */) {
      const m = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)[^>]*>?/.exec(src.slice(i, i + 256));
      if (!m) {
        const end = src.indexOf(">", i + 2);
        i = end < 0 ? n : end + 1;
        continue;
      }
      closeTo(m[1]!.toLowerCase());
      i += m[0].length;
      continue;
    }
    if (!isLetter(next)) {
      append("<");
      i += 1;
      continue;
    }
    const tag = readStartTag(src, i);
    i = tag.end;
    const name = tag.name;
    const open = current();
    if (open.tagName === "p" && P_CLOSERS.has(name)) stack.pop();
    else if ((name === "li" && open.tagName === "li") || (name === "option" && open.tagName === "option") || ((name === "dt" || name === "dd") && (open.tagName === "dt" || open.tagName === "dd"))) stack.pop();
    else if ((name === "td" || name === "th") && (open.tagName === "td" || open.tagName === "th")) stack.pop();
    else if (name === "tr" && (open.tagName === "td" || open.tagName === "th")) closeTo("tr");
    else if (name === "tr" && open.tagName === "tr") stack.pop();
    const el = new HtmlElement(name, tag.attrs);
    nodes++;
    if (stack.length > HTML_MAX_DEPTH) {
      // Profondeur bornée : l'élément est rattaché à plat, sans descendre plus loin.
      doc.truncated = true;
      append(el);
      if (RAW_TEXT.has(name) || RCDATA.has(name)) i = skipRawText(src, i, name).end;
      continue;
    }
    append(el);
    if (RAW_TEXT.has(name) || RCDATA.has(name)) {
      const raw = skipRawText(src, i, name);
      if (raw.text) el.children.push(RCDATA.has(name) ? decodeHtmlEntities(raw.text) : raw.text);
      i = raw.end;
      continue;
    }
    if (!tag.selfClosing && !VOID.has(name)) stack.push(el);
  }
  return doc;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSpace(c: string | undefined): boolean {
  return c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
}

/** Lit une balise ouvrante à partir de `start` (sur `<`). */
function readStartTag(src: string, start: number): { name: string; attrs: Map<string, string>; selfClosing: boolean; end: number } {
  let i = start + 1;
  const n = src.length;
  let name = "";
  while (i < n && !isSpace(src[i]) && src[i] !== ">" && src[i] !== "/") name += src[i++];
  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (i < n) {
    while (i < n && isSpace(src[i])) i++;
    const c = src[i];
    if (c === undefined) break;
    if (c === ">") {
      i++;
      break;
    }
    if (c === "/") {
      i++;
      if (src[i] === ">") {
        selfClosing = true;
        i++;
        break;
      }
      continue;
    }
    let attr = "";
    while (i < n && !isSpace(src[i]) && src[i] !== "=" && src[i] !== ">" && !(src[i] === "/" && src[i + 1] === ">")) attr += src[i++];
    while (i < n && isSpace(src[i])) i++;
    let value = "";
    if (src[i] === "=") {
      i++;
      while (i < n && isSpace(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        const end = src.indexOf(q, i + 1);
        value = src.slice(i + 1, end < 0 ? n : end);
        i = end < 0 ? n : end + 1;
      } else {
        while (i < n && !isSpace(src[i]) && src[i] !== ">") value += src[i++];
      }
    }
    const key = attr.toLowerCase();
    if (key && !attrs.has(key) && attrs.size < 256) attrs.set(key, decodeHtmlEntities(value));
  }
  return { name: name.toLowerCase(), attrs, selfClosing, end: i };
}

/** Contenu brut jusqu'à `</name` (insensible à la casse). */
function skipRawText(src: string, from: number, name: string): { text: string; end: number } {
  const re = new RegExp(`</${name}[\\s/>]`, "gi");
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m) return { text: src.slice(from), end: src.length };
  const close = src.indexOf(">", m.index);
  return { text: src.slice(from, m.index), end: close < 0 ? src.length : close + 1 };
}

// ---------------------------------------------------------------------------
// Sélecteurs

type AttrOp = "exists" | "=" | "^=" | "$=" | "*=" | "~=";
interface AttrTest {
  name: string;
  op: AttrOp;
  value: string;
}
interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: AttrTest[];
  /** Combinateur qui relie ce composé au précédent (à sa gauche). */
  combinator: " " | ">" | null;
}
type Complex = Compound[];

const cache = new Map<string, Complex[]>();

function compileSelector(selector: string): Complex[] {
  const hit = cache.get(selector);
  if (hit) return hit;
  const list = parseSelectorList(selector);
  if (cache.size > 500) cache.clear();
  cache.set(selector, list);
  return list;
}

const IDENT = /^-?[_a-zA-Z -￿][-_a-zA-Z0-9 -￿]*/;

function parseSelectorList(selector: string): Complex[] {
  const s = selector.trim();
  if (!s || s.length > 1024) throw new HtmlSelectorError();
  const list: Complex[] = [];
  let i = 0;
  let complex: Complex = [];
  let pending: " " | ">" | null = null;
  let cur: Compound | null = null;
  const fresh = (): Compound => ({ tag: null, id: null, classes: [], attrs: [], combinator: complex.length === 0 ? null : (pending ?? " ") });
  const flush = () => {
    if (cur) {
      complex.push(cur);
      cur = null;
      pending = null;
    }
  };
  while (i < s.length) {
    const c = s[i]!;
    if (isSpace(c)) {
      flush();
      if (complex.length > 0 && pending === null) pending = " ";
      i++;
      continue;
    }
    if (c === ">") {
      flush();
      if (complex.length === 0) throw new HtmlSelectorError();
      pending = ">";
      i++;
      continue;
    }
    if (c === ",") {
      flush();
      if (complex.length === 0 || pending === ">") throw new HtmlSelectorError();
      list.push(complex);
      complex = [];
      pending = null;
      i++;
      continue;
    }
    if (c === "*" || isLetter(c.charCodeAt(0))) {
      if (cur) throw new HtmlSelectorError();
      cur = fresh();
      if (c === "*") i++;
      else {
        const m = IDENT.exec(s.slice(i))!;
        cur.tag = m[0].toLowerCase();
        i += m[0].length;
      }
      continue;
    }
    if (c === "#" || c === ".") {
      cur ??= fresh();
      const m = IDENT.exec(s.slice(i + 1));
      if (!m) throw new HtmlSelectorError();
      if (c === "#") cur.id = m[0];
      else cur.classes.push(m[0]);
      i += 1 + m[0].length;
      continue;
    }
    if (c === "[") {
      cur ??= fresh();
      const end = s.indexOf("]", i);
      if (end < 0) throw new HtmlSelectorError();
      cur.attrs.push(parseAttrTest(s.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    // Pseudo-classes, combinateurs + et ~ : non pris en charge.
    throw new HtmlSelectorError();
  }
  flush();
  if (complex.length === 0 || pending === ">") throw new HtmlSelectorError();
  list.push(complex);
  return list;
}

function parseAttrTest(body: string): AttrTest {
  const m = /^\s*([-_a-zA-Z0-9:]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))\s*)?$/.exec(body);
  if (!m) throw new HtmlSelectorError();
  const name = m[1]!.toLowerCase();
  if (!m[2]) return { name, op: "exists", value: "" };
  return { name, op: m[2] as AttrOp, value: m[3] ?? m[4] ?? m[5] ?? "" };
}

function matchesCompound(el: HtmlElement, c: Compound): boolean {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id !== null && el.getAttribute("id") !== c.id) return false;
  for (const k of c.classes) if (!el.hasClass(k)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    switch (a.op) {
      case "exists":
        break;
      case "=":
        if (v !== a.value) return false;
        break;
      case "^=":
        if (!a.value || !v.startsWith(a.value)) return false;
        break;
      case "$=":
        if (!a.value || !v.endsWith(a.value)) return false;
        break;
      case "*=":
        if (!a.value || !v.includes(a.value)) return false;
        break;
      case "~=":
        if (!a.value || !v.split(/\s+/).includes(a.value)) return false;
        break;
    }
  }
  return true;
}

function matchesComplex(el: HtmlElement, complex: Complex, idx: number): boolean {
  const c = complex[idx]!;
  if (!matchesCompound(el, c)) return false;
  if (idx === 0) return true;
  if (c.combinator === ">") {
    const p = el.parent;
    return p !== null && p.tagName !== "#document" && matchesComplex(p, complex, idx - 1);
  }
  for (let p = el.parent; p && p.tagName !== "#document"; p = p.parent) {
    if (matchesComplex(p, complex, idx - 1)) return true;
  }
  return false;
}
