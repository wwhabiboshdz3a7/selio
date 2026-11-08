import {
  MIGRATION_MAX_FIELDS, MIGRATION_MAX_UNKNOWN_FIELDS, MIGRATION_MIN_CONFIDENCE, MIGRATION_TARGETS, migrationSource as migrationSourceSchema, orgSettings as orgSettingsSchema,
  type MigrationField, type MigrationMapping, type MigrationMappingOutput, type MigrationSource, type MigrationTarget, type MigrationTargetValue, type MigrationUnknownField, type MigrationValueKind, type OrgSettings, type RuleConfig, type RuleKind,
} from "@selio/contracts";
import { parseEuroInput } from "./money";
import { simplifyText } from "./studio";
import { sanitizeUntrustedText } from "./untrusted";

/**
 * Migration depuis un autre outil (§5.13), côté règles métier : le CATALOGUE des équivalences connues
 * « ancien → nouveau » (données pour le prompt et pour la correspondance déterministe), la conversion des
 * valeurs, la normalisation d'une correspondance proposée par le modèle, la lecture d'un fichier de
 * portabilité RGPD (clés/valeurs à plat, sans schéma supposé) et l'application des champs ACCEPTÉS par le
 * client aux réglages Selio (validés par zod).
 *
 * Ce module ne fait AUCUNE requête réseau et ne connaît aucun format propriétaire : il ne lit que ce que le
 * client colle, photographie ou importe. Aucun identifiant d'un autre outil n'est demandé ni stocké.
 */

// ----------------------------------------------------------------- catalogue

export interface MigrationCatalogEntry {
  target: MigrationTarget;
  /** Libellé Selio (écran « ancien → nouveau »). */
  label: string;
  kind: MigrationValueKind;
  /** Libellés courants dans les autres outils (sans accent ni casse : comparés avec `simplifyText`). */
  synonyms: string[];
  /** Aide à la conversion (pour le modèle et l'écran). */
  hint?: string;
}

/**
 * Équivalences connues. Ce sont des DONNÉES : le prompt les cite, le modèle ne peut viser que ces cibles ;
 * un libellé absent du catalogue reste « inconnu » (le client décide). Les libellés concurrents sont
 * des termes courants du métier, pas une copie d'un écran.
 */
export const MIGRATION_CATALOG: readonly MigrationCatalogEntry[] = [
  { target: "marginRules.minMarginCents", label: "Marge minimale (montant)", kind: "cents", synonyms: ["marge minimum", "marge mini", "marge minimale", "benefice minimum", "benef mini", "gain minimum"], hint: "Montant en centimes (5 € → 500)." },
  { target: "marginRules.minMarginRate", label: "Marge minimale (taux)", kind: "rate", synonyms: ["marge minimum en %", "marge mini %", "taux de marge minimum", "pourcentage de marge"], hint: "Taux entre 0 et 1 (25 % → 0,25)." },
  { target: "marginRules.maxDiscountRate", label: "Remise maximale", kind: "rate", synonyms: ["remise max", "remise maximale", "reduction max", "reduction maximale", "rabais maximum", "negociation max", "marge de negociation", "prix minimum en %", "prix mini en %", "prix plancher en %", "% minimum du prix"], hint: "Taux entre 0 et 1 (20 % → 0,2). Un « prix minimum en % du prix affiché » devient une remise maximale : 100 % − X." },
  { target: "marginRules.counterStepRate", label: "Pas de contre-proposition", kind: "rate", synonyms: ["pas de contre offre", "palier de contre proposition", "pas de negociation", "baisse par contre offre", "etape de negociation", "pas de remise"], hint: "Taux entre 0 et 1 (5 % → 0,05)." },
  { target: "marginRules.maxRoundsPerCustomer", label: "Contre-propositions maximales par acheteur", kind: "int", synonyms: ["nombre de contre offres", "contre offres max", "nombre de negociations", "tours de negociation", "essais de negociation", "nombre de relances de prix"], hint: "Entier de 0 à 10." },
  { target: "schedule", label: "Plage horaire d'activité", kind: "schedule", synonyms: ["horaires", "plage horaire", "heures actives", "heures d'activite", "creneau horaire", "horaires d'envoi", "actif de", "heures d'envoi"], hint: "Texte « 8h-22h » (heure de début, heure de fin)." },
  { target: "schedule.activeFrom", label: "Heure de début", kind: "hour", synonyms: ["heure de debut", "debut d'activite", "actif a partir de", "premiere heure", "debut"], hint: "Heure entière 0–23." },
  { target: "schedule.activeTo", label: "Heure de fin", kind: "hour", synonyms: ["heure de fin", "fin d'activite", "actif jusqu'a", "derniere heure", "fin"], hint: "Heure entière 1–24." },
  { target: "messages.greeting", label: "Message d'accueil", kind: "text", synonyms: ["message d'accueil", "message de bienvenue", "premier message", "salutation", "message auto d'accueil"], hint: "Texte recopié tel quel ; {prenom}, {article}, {prix} sont remplacés par Selio." },
  { target: "messages.counter", label: "Message de contre-proposition", kind: "text", synonyms: ["message de contre offre", "message contre proposition", "reponse a une offre", "message de negociation", "texte de contre offre"], hint: "Texte recopié tel quel. Selio refuse « meilleur prix » et « dernier prix » dans ce message : il est envoyé au-dessus du plancher." },
  { target: "messages.final", label: "Message de dernière offre", kind: "text", synonyms: ["message de derniere offre", "offre finale", "dernier prix", "message final", "message prix plancher"], hint: "Texte recopié tel quel ; seul message où « dernier prix » est permis (envoyé au plancher)." },
  { target: "messages.afterFinal", label: "Message après la dernière offre", kind: "text", synonyms: ["message apres refus", "relance apres offre finale", "message si refus", "apres la derniere offre"], hint: "Texte recopié tel quel." },
  { target: "messages.accepted", label: "Message d'acceptation", kind: "text", synonyms: ["message d'acceptation", "offre acceptee", "message quand j'accepte", "message accord", "message de validation"], hint: "Texte recopié tel quel." },
  { target: "messages.fallback", label: "Message de refus", kind: "text", synonyms: ["message de refus", "offre refusee", "message quand je refuse", "refus", "message prix trop bas"], hint: "Texte recopié tel quel." },
  { target: "autoReply.enabled", label: "Réponse automatique activée", kind: "bool", synonyms: ["reponse automatique", "reponses auto", "message auto", "repondeur", "reponse auto activee", "auto reply", "auto repondre"], hint: "oui / non." },
  { target: "autoReply.awayMessage", label: "Message d'absence", kind: "text", synonyms: ["message d'absence", "message hors horaires", "message de nuit", "message auto hors ligne", "reponse hors horaires", "message en dehors des horaires"], hint: "Texte recopié tel quel." },
  { target: "favorites.enabled", label: "Message aux favoris activé", kind: "bool", synonyms: ["message aux favoris", "relance favoris", "offre aux favoris", "message favori", "favoris automatiques"], hint: "oui / non." },
  { target: "favorites.message", label: "Message aux favoris", kind: "text", synonyms: ["texte favoris", "message envoye aux favoris", "texte de l'offre aux favoris", "message like"], hint: "Texte recopié tel quel." },
  { target: "favorites.offerRate", label: "Remise proposée aux favoris", kind: "rate", synonyms: ["remise favoris", "reduction favoris", "offre favoris en %", "pourcentage favoris", "remise like"], hint: "Taux entre 0 et 1 (10 % → 0,1)." },
  { target: "favorites.delayMinutes", label: "Délai avant le message aux favoris", kind: "minutes", synonyms: ["delai favoris", "attente avant message favoris", "delai avant offre favoris", "temps avant message favoris"], hint: "Minutes." },
  { target: "lot.enabled", label: "Remise sur les lots activée", kind: "bool", synonyms: ["remise lot", "lots", "remise sur les lots", "reduction lot", "negociation des lots", "bundle"], hint: "oui / non." },
  { target: "lot.twoItemsRate", label: "Remise pour 2 articles", kind: "rate", synonyms: ["remise 2 articles", "lot de 2", "reduction 2 articles", "deux articles", "remise lot 2"], hint: "Taux entre 0 et 1." },
  { target: "lot.threePlusRate", label: "Remise pour 3 articles et plus", kind: "rate", synonyms: ["remise 3 articles", "lot de 3", "reduction 3 articles et plus", "trois articles", "remise lot 3"], hint: "Taux entre 0 et 1." },
  { target: "priceDrops.enabled", label: "Baisses de prix automatiques activées", kind: "bool", synonyms: ["baisse de prix automatique", "baisses auto", "reduction automatique du prix", "diminution de prix", "price drop"], hint: "oui / non." },
  { target: "priceDrops.afterDays", label: "Baisse de prix après (jours)", kind: "days", synonyms: ["baisse apres", "jours avant baisse", "delai avant baisse de prix", "frequence des baisses"], hint: "Jours." },
  { target: "priceDrops.rate", label: "Taux de baisse de prix", kind: "rate", synonyms: ["taux de baisse", "pourcentage de baisse", "baisse de", "montant de la baisse en %"], hint: "Taux entre 0 et 1." },
  { target: "priceDrops.floorRate", label: "Prix minimal après baisses (part du prix initial)", kind: "rate", synonyms: ["prix plancher des baisses", "ne pas descendre sous", "minimum apres baisses", "limite de baisse", "plancher en % du prix initial"], hint: "Part du prix initial, entre 0 et 1 (70 % → 0,7)." },
  { target: "timing.minDelayMinutes", label: "Délai minimal avant une réponse", kind: "minutes", synonyms: ["delai minimum de reponse", "attente minimum", "delai mini", "temps de reponse minimum", "delai avant reponse"], hint: "Minutes." },
  { target: "timing.maxDelayMinutes", label: "Délai maximal avant une réponse", kind: "minutes", synonyms: ["delai maximum de reponse", "attente maximum", "delai maxi", "temps de reponse maximum"], hint: "Minutes." },
  { target: "timing.sendOffers", label: "Envoyer les contre-offres comme offres Vinted", kind: "bool", synonyms: ["envoyer une offre", "offre vinted", "contre offre en offre", "proposer via offre", "bouton offre"], hint: "oui / non." },
  { target: "timing.offerValidityHours", label: "Validité d'une offre (heures)", kind: "hours", synonyms: ["validite de l'offre", "duree de l'offre", "expiration de l'offre", "offre valable"], hint: "Heures." },
  { target: "afterSale.soldMessage", label: "Message après la vente", kind: "text", synonyms: ["message apres vente", "message vendu", "message de remerciement", "merci pour votre achat", "message commande"], hint: "Texte recopié tel quel." },
  { target: "afterSale.completedMessage", label: "Message après la validation", kind: "text", synonyms: ["message apres validation", "message fin de commande", "message apres reception", "message colis recu", "message evaluation"], hint: "Texte recopié tel quel." },
  { target: "afterSale.pickupReminderText", label: "Rappel de retrait au point relais", kind: "text", synonyms: ["rappel point relais", "message colis en attente", "rappel de retrait", "relance point relais"], hint: "Texte recopié tel quel." },
  { target: "ai.tone", label: "Ton des messages", kind: "tone", synonyms: ["ton", "ton des messages", "style des reponses", "tonalite", "style"], hint: "neutral, friendly ou concise (neutre, chaleureux, concis)." },
  { target: "ai.signature", label: "Signature", kind: "text", synonyms: ["signature", "signature des messages", "nom de boutique en signature", "signature auto"], hint: "Texte recopié tel quel (120 caractères au plus)." },
  { target: "ai.requireApproval", label: "Validation avant envoi", kind: "bool", synonyms: ["validation avant envoi", "valider avant d'envoyer", "brouillon a valider", "confirmation manuelle", "envoi manuel"], hint: "oui / non." },
  { target: "dressing.republishAfterDays", label: "Republier après (jours)", kind: "days", synonyms: ["republication", "republier apres", "remise en ligne apres", "jours avant republication", "frequence de republication", "boost"], hint: "Jours (1 à 90)." },
  { target: "followUp.delayHours", label: "Relance sans réponse après (heures)", kind: "hours", synonyms: ["relance", "delai de relance", "relance apres", "relancer apres", "relance sans reponse", "relance automatique", "follow up"], hint: "Heures (24 h = 1 jour)." },
  { target: "followUp.template", label: "Message de relance", kind: "text", synonyms: ["message de relance", "texte de relance", "relance texte", "message sans reponse"], hint: "Texte recopié tel quel." },
];

const CATALOG_BY_TARGET = new Map<MigrationTarget, MigrationCatalogEntry>(MIGRATION_CATALOG.map((e) => [e.target, e]));

export function catalogEntry(target: MigrationTarget): MigrationCatalogEntry {
  const e = CATALOG_BY_TARGET.get(target);
  if (!e) throw new Error(`Cible de migration hors catalogue : ${target}`);
  return e;
}

export function isMigrationTarget(value: unknown): value is MigrationTarget {
  return typeof value === "string" && (MIGRATION_TARGETS as readonly string[]).includes(value);
}

/** Libellés rendus pour le prompt : « syn1 », « syn2 » → cible (nature). Données, pas des instructions. */
export function catalogLines(): string[] {
  return MIGRATION_CATALOG.map((e) => `- ${e.synonyms.slice(0, 4).map((s) => `« ${s} »`).join(", ")} → ${e.target} (${e.label} ; ${e.hint ?? e.kind})`);
}

export interface CatalogMatch {
  target: MigrationTarget;
  /** 1 = libellé identique à un synonyme ; moins quand le synonyme est seulement contenu ou partagé. */
  score: number;
}

/**
 * Cible la plus probable pour un libellé lu (déterministe, sans IA) : synonyme identique, synonyme contenu
 * dans le libellé (ou l'inverse pour un libellé long), sinon recouvrement de mots d'au moins deux tiers.
 */
export function matchCatalog(sourceLabel: string): CatalogMatch | null {
  const label = simplifyText(sourceLabel);
  if (!label) return null;
  let best: CatalogMatch | null = null;
  const consider = (target: MigrationTarget, score: number) => {
    if (!best || score > best.score) best = { target, score };
  };
  const labelWords = new Set(label.split(" ").filter((w) => w.length > 2));
  for (const e of MIGRATION_CATALOG) {
    for (const syn of e.synonyms) {
      const s = simplifyText(syn);
      if (s === label) consider(e.target, 1);
      else if (s.length >= 4 && ` ${label} `.includes(` ${s} `)) consider(e.target, 0.85);
      else if (label.length >= 8 && ` ${s} `.includes(` ${label} `)) consider(e.target, 0.7);
      else {
        const words = s.split(" ").filter((w) => w.length > 2);
        if (words.length >= 2 && labelWords.size >= 2) {
          const shared = words.filter((w) => labelWords.has(w)).length;
          if (shared / Math.max(words.length, labelWords.size) >= 2 / 3) consider(e.target, 0.6);
        }
      }
    }
  }
  return best;
}

// ----------------------------------------------------------------- conversion des valeurs

export type Coerced = { ok: true; value: number | string | boolean } | { ok: false; reason: string };

const TRUE_WORDS = ["oui", "yes", "true", "on", "actif", "active", "activee", "activé", "activée", "1", "vrai", "enabled", "ok"];
const FALSE_WORDS = ["non", "no", "false", "off", "inactif", "inactive", "desactive", "desactivee", "désactivé", "désactivée", "0", "faux", "disabled"];

function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/\s| | /g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Taux : 0,2 / « 20 % » / 20 → 0,2 (un nombre entre 1 exclu et 100 est un pourcentage). */
export function coerceRate(raw: unknown): number | null {
  const n = parseNumber(raw);
  if (n === null || n < 0) return null;
  const isPercent = typeof raw === "string" && /%/.test(raw);
  const v = isPercent || n > 1 ? n / 100 : n;
  return v >= 0 && v <= 1 ? Math.round(v * 10_000) / 10_000 : null;
}

/** Durée en unités cibles : « 24 h », « 2 jours », « 30 min », nombre nu dans l'unité cible. */
function coerceDuration(raw: unknown, unit: "minutes" | "hours" | "days"): number | null {
  const n = parseNumber(raw);
  if (n === null || n < 0) return null;
  if (typeof raw !== "string") return Math.round(n);
  const s = simplifyText(raw);
  const factor: Record<"minutes" | "hours" | "days", { min: number; h: number; d: number }> = {
    minutes: { min: 1, h: 60, d: 1440 },
    hours: { min: 1 / 60, h: 1, d: 24 },
    days: { min: 1 / 1440, h: 1 / 24, d: 1 },
  };
  const f = factor[unit];
  const k = /\b(min|minute|minutes|mn)\b/.test(s) ? f.min : /\b(h|heure|heures|hr|hrs)\b/.test(s) || /\d\s*h\b/.test(s) ? f.h : /\b(j|jour|jours|day|days|d)\b/.test(s) ? f.d : 1;
  return Math.round(n * k);
}

/** Heure « 9h », « 09:30 », 9 → 9. */
export function coerceHour(raw: unknown): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  const h = Math.floor(n);
  return h >= 0 && h <= 24 ? h : null;
}

/** Plage « 8h-22h », « de 8 h à 22 h », « 08:00 – 22:00 » → { activeFrom, activeTo }. */
export function parseScheduleText(raw: unknown): { activeFrom: number; activeTo: number } | null {
  if (typeof raw !== "string") return null;
  const nums = [...raw.replace(/ | /g, " ").matchAll(/(\d{1,2})(?:\s*[:h]\s*\d{0,2})?/gi)].map((m) => Number.parseInt(m[1]!, 10));
  if (nums.length < 2) return null;
  const [from, to] = [nums[0]!, nums[1]!];
  if (from < 0 || from > 23 || to < 1 || to > 24 || to <= from) return null;
  return { activeFrom: from, activeTo: to };
}

const TONES: Record<string, "neutral" | "friendly" | "concise"> = {
  neutral: "neutral", neutre: "neutral", professionnel: "neutral", formel: "neutral", sobre: "neutral",
  friendly: "friendly", chaleureux: "friendly", amical: "friendly", sympa: "friendly", convivial: "friendly", decontracte: "friendly",
  concise: "concise", concis: "concise", court: "concise", direct: "concise", bref: "concise",
};

/** Convertit une valeur lue dans la nature attendue par la cible ; refuse plutôt que deviner. */
export function coerceTargetValue(target: MigrationTarget, raw: MigrationTargetValue | undefined): Coerced {
  const entry = catalogEntry(target);
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return { ok: false, reason: "valeur absente" };
  switch (entry.kind) {
    case "rate": {
      const v = coerceRate(raw);
      return v === null ? { ok: false, reason: "taux illisible (attendu entre 0 et 1, ou un pourcentage)" } : { ok: true, value: v };
    }
    case "cents": {
      if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 ? { ok: true, value: raw } : raw >= 0 ? { ok: true, value: Math.round(raw * 100) } : { ok: false, reason: "montant négatif" };
      if (typeof raw === "boolean") return { ok: false, reason: "montant attendu" };
      const cents = parseEuroInput(raw);
      return cents === null || cents < 0 ? { ok: false, reason: "montant illisible" } : { ok: true, value: cents };
    }
    case "int": {
      const n = parseNumber(raw);
      return n === null || n < 0 ? { ok: false, reason: "entier attendu" } : { ok: true, value: Math.round(n) };
    }
    case "hour": {
      const h = coerceHour(raw);
      return h === null ? { ok: false, reason: "heure illisible" } : { ok: true, value: h };
    }
    case "schedule": {
      const s = parseScheduleText(raw);
      return s === null ? { ok: false, reason: "plage horaire illisible (attendu « 8h-22h »)" } : { ok: true, value: `${s.activeFrom}-${s.activeTo}` };
    }
    case "minutes":
    case "hours":
    case "days": {
      const d = coerceDuration(raw, entry.kind);
      return d === null ? { ok: false, reason: "durée illisible" } : { ok: true, value: d };
    }
    case "bool": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const s = simplifyText(String(raw));
      if (TRUE_WORDS.includes(s)) return { ok: true, value: true };
      if (FALSE_WORDS.includes(s)) return { ok: true, value: false };
      return { ok: false, reason: "oui / non attendu" };
    }
    case "tone": {
      const s = simplifyText(String(raw));
      const tone = TONES[s] ?? Object.entries(TONES).find(([k]) => s.includes(k))?.[1];
      return tone ? { ok: true, value: tone } : { ok: false, reason: "ton inconnu (neutre, chaleureux ou concis)" };
    }
    case "text": {
      if (typeof raw !== "string") return { ok: false, reason: "texte attendu" };
      const text = sanitizeUntrustedText(raw, 600);
      return text.length === 0 ? { ok: false, reason: "texte vide" } : { ok: true, value: text };
    }
  }
}

/**
 * Règle des gabarits (D20) appliquée aux messages migrés : « meilleur prix » est interdit partout (le plancher
 * peut être plus bas) ; « dernier prix » n'est vrai que dans le message de dernière offre (`messages.final`).
 */
export function checkMessageWording(target: MigrationTarget, text: string): { ok: true } | { ok: false; reason: string } {
  if (catalogEntry(target).kind !== "text") return { ok: true };
  if (/meilleur prix/i.test(text)) return { ok: false, reason: "« meilleur prix » est interdit dans Selio : le plancher peut être plus bas (D20)." };
  if (/dernier prix/i.test(text) && target !== "messages.final") return { ok: false, reason: "« dernier prix » n'est permis que dans le message de dernière offre, envoyé au plancher (D20)." };
  return { ok: true };
}

/**
 * Un libellé ou une valeur qui ressemble à un identifiant, un mot de passe, un jeton ou un contact : jamais
 * migré, jamais conservé (ni dans les champs, ni dans les inconnus).
 */
const SECRET_LABEL = /\b(mot de passe|mots de passe|mdp|password|passwd|pass|pwd|passcode|pin|code|codes|token|jeton|cookie|cookies|session|api key|cle api|cle d acces|cle secrete|cle privee|apikey|key|secret|identifiant|identifiants|id de connexion|login|logins|compte|comptes|account|pseudo|pseudonyme|username|user|utilisateur|nom d utilisateur|email|e mail|mail|courriel|telephone|portable|mobile|numero|iban|bic|rib|carte|cb|cvv|cvc|otp|2fa|authentification)\b/;

/**
 * Un libellé ou une valeur qui ressemble à un identifiant, un mot de passe, un jeton ou un contact : jamais
 * migré, jamais conservé (ni dans les champs, ni dans les inconnus). Prudent par construction : un réglage
 * légitime écarté se ressaisit à la main, un secret gardé ne se rattrape pas.
 */
export function looksLikeSecret(sourceLabel: string, sourceValue: string): boolean {
  const label = simplifyText(sourceLabel);
  if (SECRET_LABEL.test(label)) return true;
  const value = sourceValue.trim();
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(value)) return true;
  if (/^(bearer\s+)?[a-z0-9_.-]{24,}$/i.test(value)) return true;
  // Mot de passe probable : un seul « mot » de 8 caractères au moins mêlant majuscules, minuscules et chiffres (« Azerty123! »).
  if (/^\S{8,64}$/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) return true;
  // Numéro de téléphone ou de carte.
  if (/^\+?[\d\s.-]{9,}$/.test(value) && value.replace(/\D/g, "").length >= 9) return true;
  return false;
}

/**
 * Un texte libre (avertissement, note du modèle) cite-t-il un secret ? Il peut citer le mot de passe qu'il
 * dit ignorer : un tel texte n'est jamais conservé, il est remplacé par un message de Selio.
 */
export function mentionsSecret(text: string): boolean {
  if (!text) return false;
  if (SECRET_LABEL.test(simplifyText(text))) return true;
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return true;
  if (/(bearer\s+)?[a-z0-9_.-]{24,}/i.test(text)) return true;
  return false;
}

const SECRET_NOTE = "Texte écarté : il semblait citer un identifiant, un mot de passe ou un contact.";

// ----------------------------------------------------------------- candidats (texte collé, fichier RGPD)

export interface MigrationCandidate {
  sourceLabel: string;
  sourceValue: string;
}

const MAX_CANDIDATES = 500;

/** Lignes « libellé : valeur » (ou « = », tabulation, « → ») d'un texte collé. Aucune interprétation. */
export function parseSettingsText(text: string): MigrationCandidate[] {
  const out: MigrationCandidate[] = [];
  for (const line of sanitizeUntrustedText(text, 50_000).split("\n")) {
    const m = line.match(/^\s*[-•*]?\s*([^:=\t→]{2,80}?)\s*(?::|=|\t|→)\s*(.{1,600})\s*$/);
    if (!m) continue;
    const sourceLabel = m[1]!.trim();
    const sourceValue = m[2]!.trim();
    if (!sourceLabel || !sourceValue) continue;
    out.push({ sourceLabel, sourceValue });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

export type RgpdExportFormat = "json" | "csv" | "text" | "empty";

export interface RgpdExportParse {
  format: RgpdExportFormat;
  candidates: MigrationCandidate[];
  warnings: string[];
}

function flattenJson(value: unknown, path: string, out: MigrationCandidate[], depth: number): void {
  if (out.length >= MAX_CANDIDATES) return;
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (depth > 6) return;
    value.slice(0, 50).forEach((v, i) => flattenJson(v, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (typeof value === "object") {
    if (depth > 6) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flattenJson(v, path ? `${path}.${k}` : k, out, depth + 1);
    return;
  }
  const text = typeof value === "string" ? value : String(value);
  if (text.trim().length === 0) return;
  out.push({ sourceLabel: path.slice(0, 120) || "valeur", sourceValue: sanitizeUntrustedText(text, 600) });
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells.map((v) => v.trim());
}

/**
 * Fichier obtenu par le client au titre de la portabilité RGPD : aucun format public fiable n'existe pour
 * ces exports, on ne suppose donc AUCUN schéma. JSON : toutes les paires clé/valeur à plat (chemins pointés).
 * CSV (séparateur , ; ou tabulation) : deux colonnes = libellé/valeur ; sinon en-têtes + lignes (« ligne 2 ›
 * colonne »). Autre texte : lignes « libellé : valeur ». Les candidats passent ensuite par le catalogue.
 */
export function parseRgpdExport(file: string): RgpdExportParse {
  const content = sanitizeUntrustedText(file.replace(/^﻿/, ""), 2_000_000);
  const warnings: string[] = [];
  if (content.trim().length === 0) return { format: "empty", candidates: [], warnings: ["Fichier vide."] };
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data: unknown = JSON.parse(trimmed);
      const candidates: MigrationCandidate[] = [];
      flattenJson(data, "", candidates, 0);
      if (candidates.length >= MAX_CANDIDATES) warnings.push(`Fichier volumineux : seules les ${MAX_CANDIDATES} premières valeurs sont lues.`);
      warnings.push("Format libre : les clés sont montrées telles quelles, sans schéma supposé ; vérifiez chaque correspondance.");
      return { format: "json", candidates, warnings };
    } catch {
      warnings.push("JSON illisible : lu comme du texte « libellé : valeur ».");
    }
  }
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const first = lines[0] ?? "";
  const delimiter = [";", ",", "\t"].map((d) => ({ d, n: splitCsvLine(first, d).length })).sort((a, b) => b.n - a.n)[0]!;
  if (delimiter.n >= 2 && lines.length >= 1) {
    const rows = lines.slice(0, 2000).map((l) => splitCsvLine(l, delimiter.d));
    const candidates: MigrationCandidate[] = [];
    if (rows.every((r) => r.length <= 2)) {
      for (const r of rows) {
        const [label, value] = [r[0] ?? "", r[1] ?? ""];
        if (label && value && !(candidates.length === 0 && /^(cl[ée]|key|nom|name|param[èe]tre|setting)$/i.test(label) && /^(valeur|value)$/i.test(value))) candidates.push({ sourceLabel: label.slice(0, 120), sourceValue: value.slice(0, 600) });
        if (candidates.length >= MAX_CANDIDATES) break;
      }
    } else {
      const headers = rows[0]!;
      for (let i = 1; i < rows.length && candidates.length < MAX_CANDIDATES; i++) {
        rows[i]!.forEach((value, j) => {
          const header = headers[j] ?? `colonne ${j + 1}`;
          if (value && candidates.length < MAX_CANDIDATES) candidates.push({ sourceLabel: `ligne ${i + 1} › ${header}`.slice(0, 120), sourceValue: value.slice(0, 600) });
        });
      }
    }
    warnings.push("Format libre : colonnes montrées telles quelles, sans schéma supposé ; vérifiez chaque correspondance.");
    return { format: "csv", candidates, warnings };
  }
  return { format: "text", candidates: parseSettingsText(content), warnings: [...warnings, "Texte libre : seules les lignes « libellé : valeur » sont lues."] };
}

// ----------------------------------------------------------------- correspondance déterministe

/** Correspondance « ancien → nouveau » sans IA, par le catalogue : base de l'import de fichier et du simulateur. */
export function suggestMappingFromCandidates(candidates: readonly MigrationCandidate[], source: MigrationSource = "unknown"): MigrationMapping {
  const fields: MigrationMappingOutput["fields"] = [];
  const unknownFields: MigrationUnknownField[] = [];
  const warnings: string[] = [];
  let secrets = 0;
  for (const c of candidates) {
    if (looksLikeSecret(c.sourceLabel, c.sourceValue)) {
      secrets++;
      continue;
    }
    const match = matchCatalog(c.sourceLabel);
    if (!match) {
      unknownFields.push({ sourceLabel: c.sourceLabel.slice(0, 120), sourceValue: "", note: "Aucun équivalent connu dans Selio." });
      continue;
    }
    fields.push({ sourceLabel: c.sourceLabel.slice(0, 120), sourceValue: c.sourceValue.slice(0, 600), target: match.target, targetValue: c.sourceValue, confidence: match.score, note: match.score === 1 ? "Libellé identique à une équivalence connue." : "Libellé proche d'une équivalence connue : à vérifier." });
  }
  if (secrets > 0) warnings.push(`${secrets} champ(s) ressemblant à un identifiant, un mot de passe ou un contact ont été ignorés : Selio ne les migre jamais.`);
  return normalizeMigrationMapping({ source, fields, unknownFields, warnings });
}

// ----------------------------------------------------------------- normalisation

/**
 * Normalise une correspondance (du modèle ou du catalogue) : identifiants `f1`, `f2`…, valeurs converties
 * dans la nature de la cible (sinon : champ inconnu), règle D20 sur les messages, confiance minimale, une
 * seule proposition par cible (la plus sûre ; les autres deviennent des champs inconnus), bornes de taille.
 */
export function normalizeMigrationMapping(output: MigrationMappingOutput, opts: { minConfidence?: number } = {}): MigrationMapping {
  const minConfidence = opts.minConfidence ?? MIGRATION_MIN_CONFIDENCE;
  const warnings = [...output.warnings];
  // Réglages inconnus : le libellé et la note seulement, JAMAIS la valeur lue (elle pourrait être un secret
  // non reconnu, et la correspondance est conservée sans limite de durée, contrairement à l'entrée brute).
  const unknown: MigrationUnknownField[] = output.unknownFields
    .filter((u) => !looksLikeSecret(u.sourceLabel, u.sourceValue))
    .map((u) => ({ sourceLabel: u.sourceLabel, sourceValue: "", note: mentionsSecret(u.note) ? SECRET_NOTE : u.note }));
  const demote = (f: MigrationMappingOutput["fields"][number], note: string) => {
    unknown.push({ sourceLabel: f.sourceLabel, sourceValue: "", note: note.slice(0, 300) });
  };
  const byTarget = new Map<MigrationTarget, { field: MigrationMappingOutput["fields"][number]; value: number | string | boolean }>();
  for (const f of output.fields) {
    if (looksLikeSecret(f.sourceLabel, f.sourceValue)) {
      warnings.push(`Champ « ${f.sourceLabel.slice(0, 40)} » ignoré : il ressemble à un identifiant, un mot de passe ou un contact.`);
      continue;
    }
    if (!f.target || !isMigrationTarget(f.target)) {
      demote(f, f.note || "Aucun équivalent Selio proposé.");
      continue;
    }
    if (f.confidence < minConfidence) {
      demote(f, `Confiance trop faible (${f.confidence.toFixed(2)}) : à décider à la main.`);
      continue;
    }
    const raw = f.targetValue ?? f.sourceValue;
    const coerced = coerceTargetValue(f.target, raw);
    if (!coerced.ok) {
      demote(f, `Valeur non convertie pour ${f.target} : ${coerced.reason}.`);
      continue;
    }
    if (typeof coerced.value === "string") {
      const wording = checkMessageWording(f.target, coerced.value);
      if (!wording.ok) {
        demote(f, wording.reason);
        warnings.push(`Message « ${f.sourceLabel.slice(0, 40)} » non repris : ${wording.reason}`);
        continue;
      }
    }
    const prev = byTarget.get(f.target);
    if (prev && prev.field.confidence >= f.confidence) {
      demote(f, `Même cible que « ${prev.field.sourceLabel.slice(0, 40)} », proposée avec plus de certitude.`);
      continue;
    }
    if (prev) demote(prev.field, `Même cible que « ${f.sourceLabel.slice(0, 40) } », proposée avec plus de certitude.`);
    byTarget.set(f.target, { field: f, value: coerced.value });
  }
  const fields: MigrationField[] = [...byTarget.values()].slice(0, MIGRATION_MAX_FIELDS).map(({ field, value }, i) => ({
    id: `f${i + 1}`,
    sourceLabel: field.sourceLabel,
    sourceValue: field.sourceValue,
    target: field.target,
    targetValue: value,
    confidence: Math.min(1, Math.max(0, field.confidence)),
    note: mentionsSecret(field.note) ? SECRET_NOTE : field.note,
  }));
  const source = migrationSourceSchema.safeParse(output.source);
  return {
    source: source.success ? source.data : "unknown",
    fields,
    unknownFields: unknown.slice(0, MIGRATION_MAX_UNKNOWN_FIELDS),
    warnings: [...new Set(warnings)].slice(0, 60),
  };
}

// ----------------------------------------------------------------- application

/**
 * Corrections de l'écran « ancien → nouveau » sur une correspondance ENREGISTRÉE : seules la cible et la
 * valeur des champs déjà proposés (même identifiant) sont reprises ; libellé, valeur lue, confiance et
 * notes restent ceux de la conversion (vérifiés à la conversion : rien d'inventé, aucun secret). Un champ
 * inconnu de la conversion est ignoré ; un champ qui ressemble à un secret est retiré. Les réglages
 * inconnus et avertissements restent ceux de la conversion.
 */
export function mergeMappingCorrection(stored: MigrationMapping, corrected: MigrationMapping | null): MigrationMapping {
  const byId = new Map((corrected?.fields ?? []).map((f) => [f.id, f]));
  const fields = stored.fields
    .filter((f) => !looksLikeSecret(f.sourceLabel, f.sourceValue))
    .map((f) => {
      const c = byId.get(f.id);
      if (!c) return f;
      const target = c.target && isMigrationTarget(c.target) ? c.target : f.target;
      return { ...f, target, targetValue: c.targetValue ?? f.targetValue };
    });
  return { ...stored, fields };
}


/** Où chaque cible s'écrit : chemin dans les réglages de l'organisation, ou configuration d'une règle d'automatisation. */
export const MIGRATION_TARGET_PATHS: Record<MigrationTarget, { settings?: readonly string[]; rule?: { kind: RuleKind; key: keyof RuleConfig } }> = {
  "marginRules.minMarginRate": { settings: ["margin", "minMarginRate"] },
  "marginRules.minMarginCents": { settings: ["margin", "minMarginCents"] },
  "marginRules.maxDiscountRate": { settings: ["margin", "maxDiscountRate"] },
  "marginRules.counterStepRate": { settings: ["margin", "counterStepRate"] },
  "marginRules.maxRoundsPerCustomer": { settings: ["margin", "maxRoundsPerCustomer"] },
  schedule: { settings: ["automation", "negotiation", "timing"] },
  "schedule.activeFrom": { settings: ["automation", "negotiation", "timing", "activeFrom"] },
  "schedule.activeTo": { settings: ["automation", "negotiation", "timing", "activeTo"] },
  "messages.greeting": { settings: ["automation", "negotiation", "messages", "greeting"] },
  "messages.counter": { settings: ["automation", "negotiation", "messages", "counter"] },
  "messages.final": { settings: ["automation", "negotiation", "messages", "final"] },
  "messages.afterFinal": { settings: ["automation", "negotiation", "messages", "afterFinal"] },
  "messages.accepted": { settings: ["automation", "negotiation", "messages", "accepted"] },
  "messages.fallback": { settings: ["automation", "negotiation", "messages", "fallback"] },
  "autoReply.enabled": { settings: ["automation", "autoReply", "enabled"] },
  "autoReply.awayMessage": { settings: ["automation", "autoReply", "awayMessage"] },
  "favorites.enabled": { settings: ["automation", "favorites", "enabled"] },
  "favorites.message": { settings: ["automation", "favorites", "message"] },
  "favorites.offerRate": { settings: ["automation", "favorites", "offerRate"] },
  "favorites.delayMinutes": { settings: ["automation", "favorites", "delayMinutes"] },
  "lot.enabled": { settings: ["automation", "negotiation", "lot", "enabled"] },
  "lot.twoItemsRate": { settings: ["automation", "negotiation", "lot", "twoItemsRate"] },
  "lot.threePlusRate": { settings: ["automation", "negotiation", "lot", "threePlusRate"] },
  "priceDrops.enabled": { settings: ["automation", "negotiation", "priceDrops", "enabled"] },
  "priceDrops.afterDays": { settings: ["automation", "negotiation", "priceDrops", "afterDays"] },
  "priceDrops.rate": { settings: ["automation", "negotiation", "priceDrops", "rate"] },
  "priceDrops.floorRate": { settings: ["automation", "negotiation", "priceDrops", "floorRate"] },
  "timing.minDelayMinutes": { settings: ["automation", "negotiation", "timing", "minDelayMinutes"] },
  "timing.maxDelayMinutes": { settings: ["automation", "negotiation", "timing", "maxDelayMinutes"] },
  "timing.sendOffers": { settings: ["automation", "negotiation", "timing", "sendOffers"] },
  "timing.offerValidityHours": { settings: ["automation", "negotiation", "timing", "offerValidityHours"] },
  "afterSale.soldMessage": { settings: ["automation", "afterSale", "soldMessage", "text"] },
  "afterSale.completedMessage": { settings: ["automation", "afterSale", "completedMessage", "text"] },
  "afterSale.pickupReminderText": { settings: ["automation", "afterSale", "pickupReminder", "text"] },
  "ai.tone": { settings: ["ai", "tone"] },
  "ai.signature": { settings: ["ai", "signature"] },
  "ai.requireApproval": { settings: ["ai", "requireApproval"] },
  "dressing.republishAfterDays": { settings: ["dressing", "republishAfterDays"] },
  "followUp.delayHours": { rule: { kind: "follow_up_no_reply", key: "delayHours" } },
  "followUp.template": { rule: { kind: "follow_up_no_reply", key: "template" } },
};

function setPath(root: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const obj = (root && typeof root === "object" && !Array.isArray(root) ? root : {}) as Record<string, unknown>;
  return { ...obj, [head!]: setPath(obj[head!], rest, value) };
}

export interface AppliedField {
  id: string;
  target: MigrationTarget;
  value: number | string | boolean;
}

export interface SkippedField {
  id: string;
  reason: string;
}

export interface MigrationApplyResult {
  /** Réglages de l'organisation après application, validés par le schéma (les champs non acceptés sont intacts). */
  settings: OrgSettings;
  /** Configurations de règles d'automatisation à fusionner par le service (relance après 24 h…). */
  ruleConfigs: Partial<Record<RuleKind, Partial<RuleConfig>>>;
  applied: AppliedField[];
  skipped: SkippedField[];
}

/**
 * Applique les champs ACCEPTÉS par le client. Chaque champ est posé puis les réglages sont revalidés par
 * zod ; un champ qui rendrait les réglages invalides (hors bornes) est ignoré et expliqué, sans toucher aux
 * autres. Les champs non acceptés ne changent rien. Les cibles de règle (`followUp.*`) sont rendues à part.
 */
export function applyMapping(currentSettings: OrgSettings, mapping: MigrationMapping, acceptedFieldIds: readonly string[]): MigrationApplyResult {
  const accepted = new Set(acceptedFieldIds);
  let settings = orgSettingsSchema.parse(currentSettings);
  const ruleConfigs: Partial<Record<RuleKind, Partial<RuleConfig>>> = {};
  const applied: AppliedField[] = [];
  const skipped: SkippedField[] = [];
  for (const f of mapping.fields) {
    if (!accepted.has(f.id)) continue;
    if (!f.target || !isMigrationTarget(f.target)) {
      skipped.push({ id: f.id, reason: "aucune cible Selio" });
      continue;
    }
    const coerced = coerceTargetValue(f.target, f.targetValue ?? f.sourceValue);
    if (!coerced.ok) {
      skipped.push({ id: f.id, reason: coerced.reason });
      continue;
    }
    if (typeof coerced.value === "string") {
      const wording = checkMessageWording(f.target, coerced.value);
      if (!wording.ok) {
        skipped.push({ id: f.id, reason: wording.reason });
        continue;
      }
    }
    const where = MIGRATION_TARGET_PATHS[f.target];
    if (where.rule) {
      const current = ruleConfigs[where.rule.kind] ?? {};
      ruleConfigs[where.rule.kind] = { ...current, [where.rule.key]: coerced.value };
      applied.push({ id: f.id, target: f.target, value: coerced.value });
      continue;
    }
    let next: unknown;
    if (f.target === "schedule") {
      const s = parseScheduleText(String(coerced.value));
      if (!s) {
        skipped.push({ id: f.id, reason: "plage horaire illisible" });
        continue;
      }
      next = setPath(settings, [...where.settings!, "activeFrom"], s.activeFrom);
      next = setPath(next, [...where.settings!, "activeTo"], s.activeTo);
    } else {
      next = setPath(settings, where.settings!, coerced.value);
    }
    const parsed = orgSettingsSchema.safeParse(next);
    if (!parsed.success) {
      skipped.push({ id: f.id, reason: `valeur hors bornes pour ${f.target} : ${parsed.error.issues.map((i) => i.message).join(", ").slice(0, 200)}` });
      continue;
    }
    settings = parsed.data;
    applied.push({ id: f.id, target: f.target, value: coerced.value });
  }
  return { settings, ruleConfigs, applied, skipped };
}

/** Ce que la migration ne fait JAMAIS (texte d'aide et d'écran, en toutes lettres). */
export const MIGRATION_FORBIDDEN_NOTE = "Selio ne demande jamais vos identifiants d'un autre outil, ne se connecte jamais à votre place, ne lit aucun serveur tiers et ne contourne aucune protection : la migration ne lit que ce que vous collez, photographiez ou importez (fichier obtenu au titre de la portabilité RGPD).";
