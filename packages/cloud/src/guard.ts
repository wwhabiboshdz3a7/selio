import { LOGIN_PATH_RE } from "./vinted";

/**
 * Détection des signaux de Vinted : CAPTCHA ou vérification anti-robot, « trop
 * de requêtes », blocage, avertissement sur le compte, session expirée.
 *
 * Le résultat sert UNIQUEMENT à s'arrêter : le service met le compte en pause
 * avec la raison, prévient le client, et ne retente rien. Aucun motif ne sert à
 * contourner une protection (pas de résolution de CAPTCHA, pas d'attente
 * « qu'il disparaisse », pas de changement d'empreinte).
 *
 * Les motifs sont lisibles et listés dans `BLOCK_MOTIFS`. Ils sont cherchés :
 * - dans l'URL (domaine d'un service de vérification, page de connexion) ;
 * - dans le balisage SANS les scripts ni les styles (un script anti-robot chargé
 *   sur toutes les pages ne doit pas déclencher de pause) : cadres de CAPTCHA
 *   visibles, page d'attente de vérification ;
 * - dans le texte « en évidence » : titre, titres h1–h3, zones `role="alert"`,
 *   `role="dialog"`, `aria-live`, `aria-modal`, et tout le texte quand la page est
 *   courte et sans champ de saisie (pages d'erreur). Le corps des messages d'une
 *   conversation n'est pas « en évidence » : un acheteur qui écrit « trop de
 *   requêtes » ne met pas le compte en pause.
 * Les textes sont comparés en minuscules, sans accents, apostrophes droites.
 *
 * Ces motifs sont construits sans page réelle de blocage : ils sont à compléter
 * dès qu'un vrai signal est observé (capture à joindre au test).
 */

export const BLOCK_CODES = ["captcha", "rate_limited", "blocked", "warning", "not_logged_in"] as const;
export type BlockCode = (typeof BLOCK_CODES)[number];

export interface BlockSignal {
  code: BlockCode;
  /** Message lisible pour le client et le journal (aucune donnée de la page). */
  message: string;
  /** Identifiant du motif reconnu (diagnostic). */
  pattern: string;
}

export interface DetectOptions {
  /** Statut HTTP de la réponse principale, quand on le connaît. */
  status?: number | null;
  /**
   * Vrai (défaut) quand on attend une page de membre connecté (conversation,
   * article à soi) : une page de connexion veut alors dire « session expirée ».
   */
  expectMember?: boolean;
}

export const BLOCK_MESSAGES: Readonly<Record<BlockCode, string>> = Object.freeze({
  captcha: "Vinted a affiché un CAPTCHA ou une vérification anti-robot. Le compte est mis en pause ; rien n'est retenté.",
  rate_limited: "Vinted a répondu « trop de requêtes ». Le compte est mis en pause ; rien n'est retenté.",
  blocked: "Vinted a bloqué l'accès. Le compte est mis en pause ; rien n'est retenté.",
  warning: "Vinted a affiché un avertissement sur le compte. Le compte est mis en pause ; rien n'est retenté.",
  not_logged_in: "La session Vinted n'est plus reconnue : reconnectez-vous dans la fenêtre sécurisée.",
});

type Where = "url" | "markup" | "text";

export interface BlockMotif {
  id: string;
  code: BlockCode;
  where: Where;
  re: RegExp;
  /** Seulement quand on attend une page de membre. */
  memberOnly?: boolean;
}

/** Table des motifs, dans l'ordre de priorité (un CAPTCHA sur une page de connexion reste un CAPTCHA). */
export const BLOCK_MOTIFS: readonly BlockMotif[] = [
  // CAPTCHA et vérifications anti-robot
  { id: "captcha.url.datadome", code: "captcha", where: "url", re: /(^|\.)captcha-delivery\.com$/ },
  { id: "captcha.url.cloudflare", code: "captcha", where: "url", re: /(^|\.)challenges\.cloudflare\.com$/ },
  { id: "captcha.url.path", code: "captcha", where: "url", re: /^\/(?:captcha|challenge)(?:[/?#]|$)|[?&]__cf_chl_/ },
  { id: "captcha.markup.datadome", code: "captcha", where: "markup", re: /captcha-delivery\.com/ },
  { id: "captcha.markup.recaptcha", code: "captcha", where: "markup", re: /recaptcha\/(?:api2|enterprise)\/anchor\?(?![^"'>]*size=invisible)/ },
  { id: "captcha.markup.hcaptcha", code: "captcha", where: "markup", re: /hcaptcha\.com\/captcha\/[^"'>]*frame=(?:checkbox|challenge)/ },
  { id: "captcha.markup.cloudflare", code: "captcha", where: "markup", re: /id\s*=\s*["']?(?:challenge-form|challenge-running|challenge-stage|cf-challenge-running)\b/ },
  {
    id: "captcha.text",
    code: "captcha",
    where: "text",
    re: /captcha|verifie[sz]? que (?:vous etes|tu es) (?:un )?humain|(?:vous n'etes|tu n'es) pas un robot|je ne suis pas un robot|not a robot|are you (?:a robot|human)|just a moment|un instant\b.*verification|checking your browser|verification de securite|verification anti-?robot/,
  },
  // Trop de requêtes
  { id: "rate_limited.text", code: "rate_limited", where: "text", re: /trop de (?:requetes|demandes|tentatives)|too many (?:requests|attempts)|rate limit/ },
  // Blocage
  {
    id: "blocked.text",
    code: "blocked",
    where: "text",
    re: /(?:ton|votre) compte (?:a ete|est) (?:\w+ )?(?:suspendu|bloque|desactive|banni|ferme)|compte (?:suspendu|bloque|banni)|acces refuse|access denied|(?:vous avez|tu as) ete bloquee?s?|you have been blocked|request blocked|your account (?:has been|is) (?:suspended|blocked|banned|closed)/,
  },
  // Avertissement
  {
    id: "warning.text",
    code: "warning",
    where: "text",
    re: /avertissement|(?:ton|votre) compte (?:a ete|est) (?:\w+ )?(?:averti|restreint|limite)|activite (?:inhabituelle|suspecte)|comportement (?:automatise|inhabituel|suspect)|unusual activity|suspicious activity|your account (?:has been|is) (?:restricted|limited|warned)/,
  },
  // Session expirée : page de connexion à la place d'une page de membre
  { id: "not_logged_in.url", code: "not_logged_in", where: "url", re: LOGIN_PATH_RE, memberOnly: true },
  { id: "not_logged_in.markup.password", code: "not_logged_in", where: "markup", re: /<input\b[^>]*\btype\s*=\s*["']?password\b/, memberOnly: true },
  { id: "not_logged_in.text", code: "not_logged_in", where: "text", re: /connecte-toi|connectez-vous|inscris-toi|inscrivez-vous|se connecter|log in to|sign in to/, memberOnly: true },
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", laquo: "«", raquo: "»" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Minuscules, sans accents, apostrophes droites, espaces simples. */
export function normalizeText(s: string): string {
  return decodeEntities(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[  \s]+/g, " ")
    .toLowerCase()
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** Balisage sans scripts, styles, modèles ni commentaires. */
function visibleMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

const SHORT_PAGE_CHARS = 600;
const REGION_CHARS = 600;
const REGION_OPEN_RE = /<[a-z][a-z0-9-]*\b[^>]*\b(?:role\s*=\s*["']?(?:alert|alertdialog|dialog|status)\b|aria-live\s*=\s*["']?(?:assertive|polite)\b|aria-modal\s*=\s*["']?true\b)[^>]*>/gi;

/** Texte « en évidence » (voir l'en-tête du fichier), normalisé. */
export function prominentText(html: string): string {
  const markup = visibleMarkup(html);
  const parts: string[] = [];
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(markup);
  if (title?.[1]) parts.push(title[1]);
  for (const m of markup.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) parts.push(stripTags(m[2] ?? ""));
  for (const m of markup.matchAll(REGION_OPEN_RE)) {
    const start = (m.index ?? 0) + m[0].length;
    parts.push(stripTags(markup.slice(start, start + REGION_CHARS)));
  }
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(markup)?.[1] ?? markup;
  const bodyText = normalizeText(stripTags(body));
  const hasInput = /<(?:textarea|input|select)\b/i.test(body);
  if (bodyText.length <= SHORT_PAGE_CHARS && !hasInput) parts.push(bodyText);
  return normalizeText(parts.join(" • "));
}

function urlTargets(url: string): { host: string; pathAndQuery: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), pathAndQuery: `${u.pathname}${u.search}` };
  } catch {
    return { host: "", pathAndQuery: "" };
  }
}

function signal(code: BlockCode, pattern: string): BlockSignal {
  return { code, message: BLOCK_MESSAGES[code], pattern };
}

/**
 * Renvoie le premier signal reconnu, ou `null` si la page ne montre rien qui
 * oblige à s'arrêter. Pur, sans réseau ; testé sur de petites pages écrites
 * dans les tests.
 */
export function detectBlock(html: string, url: string, options: DetectOptions = {}): BlockSignal | null {
  const expectMember = options.expectMember ?? true;
  const status = options.status ?? null;
  const { host, pathAndQuery } = urlTargets(url);
  const markup = visibleMarkup(html ?? "").toLowerCase();
  const text = prominentText(html ?? "");

  const test = (m: BlockMotif): boolean => {
    if (m.memberOnly && !expectMember) return false;
    if (m.where === "url") return (host !== "" && m.re.test(host)) || (pathAndQuery !== "" && m.re.test(pathAndQuery));
    if (m.where === "markup") return m.re.test(markup);
    return m.re.test(text);
  };

  for (const m of BLOCK_MOTIFS) {
    if (m.code !== "captcha") break;
    if (test(m)) return signal("captcha", m.id);
  }
  if (status === 429) return signal("rate_limited", "rate_limited.http429");
  for (const m of BLOCK_MOTIFS) if (m.code === "rate_limited" && test(m)) return signal("rate_limited", m.id);
  for (const m of BLOCK_MOTIFS) if (m.code === "blocked" && test(m)) return signal("blocked", m.id);
  if (status === 403) return signal("blocked", "blocked.http403");
  for (const m of BLOCK_MOTIFS) if (m.code === "warning" && test(m)) return signal("warning", m.id);
  for (const m of BLOCK_MOTIFS) if (m.code === "not_logged_in" && test(m)) return signal("not_logged_in", m.id);
  return null;
}
