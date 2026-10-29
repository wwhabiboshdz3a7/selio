/**
 * Domaines de Vinted reconnus par Selio : une liste FERMÉE, partagée par les contrats, le service
 * Cloud et le socle navigateur (@selio/cloud). Une expression du type « vinted.<2 ou 3 lettres> »
 * laissait passer des domaines qui n'appartiennent pas à Vinted (vinted.xyz, vinted.lol…) : un
 * client aurait pu envoyer le navigateur du Cloud sur un hôte à lui et y faire garder des cookies.
 *
 * Chaque entrée est un domaine enregistré par Vinted pour un pays où le service est ouvert. Ajouter
 * un pays = ajouter une ligne, après vérification sur le vrai site (liste à revoir à chaque
 * ouverture de pays).
 */
export const VINTED_DOMAINS = Object.freeze([
  "vinted.fr",
  "vinted.be",
  "vinted.lu",
  "vinted.nl",
  "vinted.de",
  "vinted.at",
  "vinted.es",
  "vinted.pt",
  "vinted.it",
  "vinted.co.uk",
  "vinted.ie",
  "vinted.com",
  "vinted.pl",
  "vinted.cz",
  "vinted.sk",
  "vinted.lt",
  "vinted.hu",
  "vinted.ro",
  "vinted.hr",
  "vinted.si",
  "vinted.gr",
  "vinted.se",
  "vinted.dk",
  "vinted.fi",
] as const);
export type VintedDomain = (typeof VINTED_DOMAINS)[number];

/** Étiquette DNS valide (sous-domaine) : lettres, chiffres, tirets, sans tiret au bord. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Hôte normalisé : minuscules, sans point de tête (cookie de domaine), sans espace. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\./, "");
}

/**
 * Vrai pour un domaine de la liste ou l'un de ses sous-domaines (`www.vinted.fr`, `.vinted.co.uk`,
 * `api.vinted.be`). Refuse `notvinted.fr`, `vinted.fr.evil.com`, `vinted.xyz`, un port, une IP.
 */
export function isVintedHost(host: string): boolean {
  if (typeof host !== "string") return false;
  const h = normalizeHost(host);
  if (h.length === 0 || h.length > 253) return false;
  for (const d of VINTED_DOMAINS) {
    if (h === d) return true;
    if (h.endsWith(`.${d}`)) {
      const sub = h.slice(0, -(d.length + 1));
      return sub.split(".").every((label) => LABEL_RE.test(label));
    }
  }
  return false;
}

/** Origine `https://` d'un hôte Vinted (le stockage local d'une page http n'est jamais gardé). */
export function isVintedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.port === "" && isVintedHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Hôte retenu pour construire une adresse Vinted (réglage `vintedHost` d'une connexion) : un hôte de
 * la liste, `www.` compris, sinon null. Sert à valider ce qu'un client peut régler.
 */
export function normalizeVintedHost(host: unknown): string | null {
  if (typeof host !== "string") return null;
  const h = normalizeHost(host);
  return isVintedHost(h) ? h : null;
}

/**
 * Cookies de passage des services anti-robot (DataDome, Cloudflare, Akamai, Imperva, PerimeterX,
 * AWS WAF, DDoS-Guard…). Ils prouvent qu'une vérification a été passée : les garder dans une session
 * Cloud ferait d'une vérification humaine un laissez-passer pour le robot. Ils sont donc écartés de
 * toute session enregistrée ou réinjectée, quel que soit leur domaine.
 */
export const ANTI_BOT_COOKIE_RE =
  /^(?:datadome|dd_[a-z0-9_]*|cf_clearance|__cf_bm|_cfuvid|__cflb|cf_chl_[a-z0-9_]*|_abck|bm_sz|bm_sv|bm_mi|ak_bmsc|reese84|incap_ses_[a-z0-9_]*|visid_incap_[a-z0-9_]*|nlbi_[a-z0-9_]*|_px\d*|_pxhd|_pxvid|_pxff_[a-z0-9_]*|pxcts|aws-waf-token|__ddg\d*_?|__ddgid_?|__ddgmark_?)$/i;

export function isAntiBotCookie(name: string): boolean {
  return typeof name === "string" && ANTI_BOT_COOKIE_RE.test(name.trim());
}
