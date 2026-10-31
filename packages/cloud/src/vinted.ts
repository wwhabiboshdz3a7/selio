import { COMPOSER_SELECTORS, SUPPORTED_HOSTS, VINTED_ADAPTER_VERSION, detectPage, parseConversationPage } from "@selio/connectors/vinted-adapter";
import { isVintedDomain } from "./session";

/**
 * Ce que le Cloud sait de Vinted.
 *
 * Les sélecteurs de lecture (conversation, messages, champ de réponse) viennent
 * de l'adaptateur DOM versionné du connecteur (`@selio/connectors`, v1) : ils
 * sont réutilisés tels quels, jamais recopiés. L'adaptateur v1 ne sert qu'à
 * pré-remplir (l'extension n'envoie rien) ; il ne connaît donc ni le bouton
 * d'envoi, ni le menu membre, ni l'URL de connexion. Les compléments ci-dessous
 * sont propres au Cloud, NON VÉRIFIÉS EN RÉEL, et devront rejoindre un
 * adaptateur v2 du connecteur (jamais modifier v1 en place, docs/CONNECTORS.md).
 */
export { COMPOSER_SELECTORS, SUPPORTED_HOSTS, VINTED_ADAPTER_VERSION, detectPage, parseConversationPage };

/** Version des compléments Cloud (à reporter dans le journal d'action). */
export const CLOUD_VINTED_SELECTORS_VERSION = "cloud-vinted-v1";

/** URL de connexion Vinted (l'adaptateur v1 n'en définit pas). À valider en réel. */
export const VINTED_LOGIN_URL = "https://www.vinted.fr/member/signup/select_type";

/** Origine Vinted par défaut des actions (les URL relatives s'y résolvent). */
export const VINTED_BASE_URL = "https://www.vinted.fr";

/**
 * Bouton d'envoi : d'abord le bouton `submit` du formulaire qui contient le
 * champ de réponse de l'adaptateur, sinon un bouton dont le nom accessible est
 * « Envoyer » (texte ou `aria-label`). Complément Cloud, non vérifié.
 */
export const SEND_BUTTON_IN_FORM = 'button[type="submit"]';
export const SEND_BUTTON_NAME = /^\s*envoyer\s*$/i;

/** Menu membre visible seulement une fois connecté. Complément Cloud, non vérifié. */
export const MEMBER_MENU_SELECTORS = [
  '[data-testid="header--user-menu"]',
  '[data-testid="user-menu-button"]',
  '[data-testid="header-user-menu"]',
  "#user-menu-button",
];

/**
 * Cookies qui n'existent qu'une fois connecté (jetons web de Vinted). À valider
 * en réel : la présence seule ne suffit pas, l'URL doit aussi être hors des
 * pages de connexion (voir `LoginWindow.isLoggedIn`).
 */
export const VINTED_SESSION_COOKIE_NAMES = ["access_token_web", "refresh_token_web"];

/** Bouton de republication (action lourde, non vérifiée, désactivée par défaut). */
export const REPUBLISH_BUTTON_SELECTORS = ['[data-testid="item-relist-button"]', '[data-testid="item-repost-button"]'];
export const REPUBLISH_BUTTON_NAME = /^\s*republier\s*$/i;

/** Pages de connexion et d'inscription : y atterrir pendant une action veut dire « session expirée ». */
export const LOGIN_PATH_RE = /^\/(?:member\/(?:login|signup)|login|signup|session|auth)(?:[/?#]|$)/i;

export function isLoginPath(pathname: string): boolean {
  return LOGIN_PATH_RE.test(pathname);
}

/**
 * Hôtes vers lesquels la fenêtre de connexion peut naviguer (cadre principal) :
 * Vinted (liste fermée des domaines, `VINTED_DOMAINS` des contrats), et les
 * fournisseurs de connexion que Vinted propose. Tout le reste est refusé, pour
 * que la fenêtre ne serve jamais de navigateur général.
 */
export const LOGIN_EXTRA_HOSTS = ["accounts.google.com", "www.facebook.com", "m.facebook.com", "appleid.apple.com"];

export function isAllowedLoginHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return isVintedDomain(h) || LOGIN_EXTRA_HOSTS.includes(h);
}

/** Adresse autorisée pour le cadre principal de la fenêtre de connexion : https, port par défaut, hôte autorisé. */
export function isAllowedLoginUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.port === "" && u.username === "" && u.password === "" && isAllowedLoginHost(u.hostname);
}

/**
 * Page affichée acceptable dans le cadre principal : une adresse autorisée, la page vide de départ,
 * ou la page d'erreur de Chromium qui remplace une navigation que nous avons bloquée.
 */
export function isAllowedLoginNavigation(url: string): boolean {
  return url === "about:blank" || url.startsWith("chrome-error://") || isAllowedLoginUrl(url);
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Hôte local ou privé (la machine elle-même, le réseau local, les adresses de lien local) : jamais
 * joint depuis la fenêtre de connexion. Défense en profondeur : une règle du pare-feu de la machine
 * pour l'utilisateur de Chromium reste conseillée (docs/CLOUD.md §7), un nom DNS qui pointe vers une
 * adresse privée n'étant pas visible ici.
 */
export function isLocalOrPrivateHost(hostname: string): boolean {
  let h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "" || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = IPV4_RE.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
    if (mapped?.[1]) return isLocalOrPrivateHost(mapped[1]);
  }
  return false;
}
