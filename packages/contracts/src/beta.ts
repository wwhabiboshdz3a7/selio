import { TRIAL_PLAN, type PaidPlan } from "./org";

/**
 * Bêta Selio (ouverture le lundi 30 novembre 2026) : « les gens ne mettent pas leur carte bleue, mais ils mettent
 * un code. Si le code est mis, ils auront un mois gratuit. […] Au bout d'un mois, ça bloque s'ils ne mettent pas
 * de données bancaires » (Ibrahim).
 *
 * - Le code (BETA2026SELIO) est une offre commerciale de sorte « beta » (migration 0024), visible et modifiable
 *   dans Selio Admin › Offres (nom, code, durée de l'accès, période, maximum d'utilisations, activation).
 * - Saisi à l'inscription (sans tenir compte de la casse, des espaces ni des tirets) : accès bêta de 30 jours au
 *   forfait de l'essai (Pro, `TRIAL_PLAN`), SANS carte, compte qualifié « Bêta », et une facture à 0,00 €
 *   « Selio — accès bêta, 1 mois offert » numérotée comme les autres. Une seule fois par compte.
 * - À la fin du mois sans moyen de paiement : « accès bêta terminé ». L'application affiche un écran de blocage
 *   (sauf Abonnement, Factures, Export de données et déconnexion) et l'API refuse les actions métier (402
 *   `beta_ended`). Les données sont conservées. Une prolongation ou un accès offert (Selio Admin), ou un paiement,
 *   débloque.
 */

/** Code de la bêta, créé par la migration 0024 (modifiable ensuite dans Selio Admin › Offres). */
export const BETA_CODE = "BETA2026SELIO";
/** Durée de l'accès bêta par défaut (jours) ; réglable par offre (1 à 90). */
export const BETA_DAYS = 30;
export const BETA_DAYS_MAX = 90;
/**
 * Forfait de l'accès bêta : celui de l'essai (Pro). Agence n'est pas ouvert : l'essai lui-même donne Pro, et
 * Agence (10 comptes, équipe) se décide avec l'équipe Selio.
 */
export const BETA_PLAN: PaidPlan = TRIAL_PLAN as PaidPlan;
/** Libellé de la ligne de la facture à 0 € émise à l'ouverture de l'accès bêta. */
export const BETA_INVOICE_LINE_LABEL = "Selio — accès bêta, 1 mois offert";
/** Code d'erreur de l'API quand une action métier est refusée après la fin du mois de bêta (HTTP 402). */
export const BETA_ENDED_ERROR = "beta_ended";
export const BETA_ENDED_TITLE = "Votre mois de bêta est terminé";
export const BETA_ENDED_MESSAGE = "Votre mois de bêta est terminé — ajoutez un moyen de paiement pour continuer. Vos données sont conservées.";
/** Rappels avant la fin (bandeau dans l'application, email si l'envoi d'emails est configuré) : J-7 puis J-1. */
export const BETA_REMINDER_DAYS = [7, 1] as const;
export type BetaReminder = (typeof BETA_REMINDER_DAYS)[number];

/**
 * Forme compacte d'un code (majuscules, lettres et chiffres seulement) : « beta2026selio », « BETA-2026-SELIO »
 * et « Beta 2026 Selio » donnent tous « BETA2026SELIO ». Sert à retrouver un code saisi avec d'autres séparateurs.
 */
export function compactOfferCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Vrai si le texte saisi désigne ce code (par défaut celui de la bêta), quels que soient la casse et les séparateurs. */
export function isSameOfferCode(raw: unknown, code: string = BETA_CODE): boolean {
  const c = compactOfferCode(raw);
  return c.length > 0 && c === compactOfferCode(code);
}

const DAY_MS = 86_400_000;

/** Fin de l'accès bêta ouvert à `from` pour `days` jours. */
export function betaEndDate(from: Date, days: number = BETA_DAYS): Date {
  return new Date(from.getTime() + Math.max(1, Math.round(days)) * DAY_MS);
}

/** Jours restants avant `endsAt` (arrondi au jour supérieur ; 0 quand c'est fini). */
export function betaDaysLeft(endsAt: string | Date, now: Date = new Date()): number {
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

/** Rappel à afficher pour ce nombre de jours restants : J-1 (1 jour ou moins), J-7 (7 jours ou moins), sinon aucun. */
export function betaReminderFor(daysLeft: number | null): BetaReminder | null {
  if (daysLeft === null || daysLeft <= 0) return null;
  if (daysLeft <= 1) return 1;
  if (daysLeft <= 7) return 7;
  return null;
}

/** Date courte JJ/MM/AAAA (heure de Paris), pour « mois offert jusqu'au 26/12/2026 ». */
export function betaDateLabel(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(d);
}

/**
 * État de l'accès bêta d'une organisation (session, GET /api/beta) ; null pour un compte sans accès bêta.
 * - « running » : mois de bêta en cours (ou prolongé, ou accès offert par l'équipe Selio) ;
 * - « ended » : mois terminé sans moyen de paiement : compte bloqué (`blocked`) ;
 * - « converted » : la suite a démarré (abonnement payé, ou forfait retenu sur la page de paiement en attendant
 *   l'ouverture du paiement en ligne).
 */
export interface BetaStatus {
  code: string | null;
  plan: PaidPlan;
  startedAt: string;
  /** Fin de l'accès en cours (essai bêta ou accès offert), sinon null. */
  endsAt: string | null;
  state: "running" | "ended" | "converted";
  blocked: boolean;
  /** Bloqué depuis cette date (fin du mois de bêta). */
  blockedSince: string | null;
  daysLeft: number | null;
  /** Bandeau de rappel à montrer (J-7, J-1), seulement si aucun moyen de paiement n'est encore enregistré. */
  reminder: BetaReminder | null;
  /** Un moyen de paiement est enregistré (carte, ou forfait retenu en paiement simulé) : rien ne bloquera. */
  paymentReady: boolean;
  /** Écran « Bienvenue dans la bêta » déjà vu (par un membre de l'organisation). */
  welcomeSeen: boolean;
  /** Numéro de la facture à 0 € de l'ouverture (SEL-AAAA-000001). */
  invoiceNumber: string | null;
}

/** Réponse d'une vérification de code à l'inscription (POST /api/offers/check-signup, sans session). */
export interface SignupCodeCheck {
  valid: boolean;
  /** Code de la bêta : accès de `days` jours au forfait `plan`, sans carte. */
  beta?: { days: number; plan: PaidPlan };
  message: string;
}
