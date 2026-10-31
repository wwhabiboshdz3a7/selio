import { z } from "zod";
import { id, isoDate } from "./common";
import { schedule, type RuleKind } from "./automation";
import { isAntiBotCookie, isVintedHost, isVintedOrigin } from "./vinted-domains";

/**
 * Selio Cloud : automatisation quand l'ordinateur du client est éteint. Un profil de navigateur
 * isolé par compte Vinted sur notre machine ; le client se connecte lui-même dans ce navigateur
 * (aucun mot de passe Vinted ne transite ni n'est stocké). Seule la session du compte (cookies et
 * stockage local des domaines vinted.*) est gardée, chiffrée, supprimable en un clic. Ces contrats
 * ne portent jamais le contenu d'une session : seulement « une session est enregistrée » et sa date.
 */

// ---------------------------------------------------------------- constantes et réglages

/** Version du texte d'accord : à incrémenter dès que le texte change (un accord n'est valable que pour sa version). */
export const CLOUD_CONSENT_VERSION = "2026-10-29.2";

/**
 * Texte d'accord affiché avant toute activation (≈ 10 lignes, honnête). L'empreinte SHA-256 de
 * ce texte est enregistrée avec l'accord : on peut prouver ce que le client a lu et accepté.
 */
export const CLOUD_CONSENT_TEXT = [
  "Selio Cloud agit sur votre compte Vinted depuis notre machine, quand votre ordinateur est éteint : répondre à un message, relancer un acheteur après 24 h.",
  "Les conditions d'utilisation de Vinted interdisent l'accès au service par des robots ou d'autres moyens automatisés. En activant le Cloud, vous acceptez ce risque : votre compte peut recevoir un avertissement, être limité ou suspendu. Selio ne peut pas l'exclure et ne promet pas « zéro risque ».",
  "Au lancement, tous les comptes Cloud partagent l'adresse IP de notre machine. Si un compte est sanctionné, Vinted peut bloquer cette adresse, donc gêner les autres comptes qui l'utilisent.",
  "Vous vous connectez vous-même dans un navigateur isolé, réservé à ce compte. Votre mot de passe Vinted n'est jamais enregistré, jamais journalisé, jamais transmis à l'IA ni à quiconque.",
  "Seule la session de ce compte (cookies et stockage local des domaines vinted.*) est conservée, chiffrée sur notre machine et isolée des autres comptes. Vous pouvez la supprimer à tout moment en un clic ; elle est effacée dès que vous arrêtez le Cloud, déconnectez ou supprimez le compte.",
  "Le navigateur n'est ouvert que pour agir, au rythme humain, dans les plafonds de votre offre, puis refermé. Aucun contournement de CAPTCHA ni de protection anti-bot : au premier CAPTCHA, avertissement, blocage ou message « trop de requêtes », le compte est mis en pause et vous êtes prévenu. Rien n'est retenté sans votre accord.",
  "Les sauvegardes chiffrées de notre base sont gardées 30 jours : une session supprimée peut y rester jusqu'à leur rotation, toujours chiffrée. Après une restauration, aucune session n'est réutilisée : tous les comptes Cloud sont mis en pause et vous devez vous reconnecter.",
  "Chaque action est inscrite dans un journal que vous pouvez consulter et exporter ; il est conservé 90 jours.",
  "Vous restez seul titulaire et responsable de votre compte Vinted et de ce qui y est envoyé ou publié. Vous pouvez mettre en pause ou arrêter le Cloud à tout moment.",
  "Selio est un outil indépendant de Vinted : ni affilié, ni approuvé, ni sponsorisé par Vinted.",
].join("\n");

/** Comptes Cloud au plus par organisation (surchargeable par CLOUD_MAX_ACCOUNTS_PER_ORG, jamais au-delà de l'offre). */
export const CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT = 10;
/**
 * Navigateurs ouverts en même temps sur la machine. La cible de 50 est une hypothèse à mesurer
 * (≈ 350 Mo par navigateur) : la valeur par défaut reste prudente tant qu'aucune mesure n'existe.
 */
export const CLOUD_MAX_BROWSERS_DEFAULT = 5;
/** Journal des actions conservé 90 jours. */
export const CLOUD_JOURNAL_RETENTION_DAYS = 90;
/**
 * Durée de validité d'une fenêtre de connexion (le client se connecte lui-même) : la même que
 * CLOUD_LOGIN_TIMEOUT_MS (5 min par défaut), qui ferme le navigateur côté worker.
 */
export const CLOUD_LOGIN_TTL_MINUTES = 5;
/**
 * Fenêtres de connexion ouvertes en même temps pour une organisation. Chaque fenêtre tient un
 * navigateur jusqu'à 5 min : sans limite, une organisation pourrait occuper tous les navigateurs.
 */
export const CLOUD_MAX_LOGIN_WINDOWS_PER_ORG = 2;
/**
 * Coupe-circuit de la machine : après un « trop de requêtes » ou un blocage de Vinted sur un compte,
 * plus aucune action Cloud n'est lancée sur l'adresse partagée pendant ce délai (à valider avec
 * Ibrahim : le prompt ne prévoit qu'une pause par compte). L'opérateur est alerté dans les journaux.
 */
export const CLOUD_CIRCUIT_BREAKER_MINUTES = 60;
/** Rythme humain : au plus N actions par heure et par compte, et un délai minimal entre deux actions (plus un aléa). */
export const CLOUD_MAX_ACTIONS_PER_HOUR = 12;
export const CLOUD_MIN_MINUTES_BETWEEN_ACTIONS = 3;
export const CLOUD_JITTER_MAX_MINUTES = 4;
/** Verrou applicatif par compte : un passage interrompu libère le compte après ce délai. */
export const CLOUD_LOCK_STALE_MINUTES = 15;
/**
 * Une tâche Cloud qui attend depuis plus longtemps (compte en pause, hors heures, plafond atteint)
 * est ignorée plutôt qu'exécutée en retard : on ne répond pas à un message trois jours après.
 */
export const CLOUD_JOB_MAX_AGE_HOURS = 24;

/**
 * Heures actives par défaut du Cloud (heure locale de l'organisation) : 8 h – 23 h, jamais la nuit.
 * Même valeur que CLOUD_ACTIVE_HOURS (« 8-23 ») côté API et worker et que `pacing.ts`.
 */
export const cloudActiveHours = schedule;
export const CLOUD_ACTIVE_HOURS_DEFAULT = schedule.parse({ days: [1, 2, 3, 4, 5, 6, 0], startHour: 8, endHour: 23, timezone: "Europe/Paris" });

// ---------------------------------------------------------------- énumérations

export const CLOUD_ACCOUNT_STATUSES = ["needs_login", "active", "paused", "stopped"] as const;
export const cloudAccountStatus = z.enum(CLOUD_ACCOUNT_STATUSES);
export type CloudAccountStatus = z.infer<typeof cloudAccountStatus>;

export const CLOUD_ACCOUNT_STATUS_LABELS: Record<CloudAccountStatus, string> = {
  needs_login: "Connexion à faire",
  active: "Actif",
  paused: "En pause",
  stopped: "Arrêté",
};

/**
 * Raisons de pause : « client » (bouton Pause), signal de Vinted, passage interrompu (arrêt brutal
 * du worker pendant une action : résultat inconnu) ou restauration d'une sauvegarde (sessions
 * effacées, reconnexion obligatoire). Une pause venue de Vinted exige un acquittement explicite du
 * client avant la reprise (rien n'est retenté tout seul).
 */
export const CLOUD_VINTED_PAUSE_REASONS = ["captcha", "warning", "blocked", "rate_limited"] as const;
export const CLOUD_PAUSE_REASONS = ["client", ...CLOUD_VINTED_PAUSE_REASONS, "interrupted", "restored"] as const;
export const cloudPauseReason = z.enum(CLOUD_PAUSE_REASONS);
export type CloudPauseReason = z.infer<typeof cloudPauseReason>;

export const CLOUD_PAUSE_REASON_LABELS: Record<CloudPauseReason, string> = {
  client: "Mise en pause par vous",
  captcha: "Vinted a affiché un CAPTCHA",
  warning: "Vinted a affiché un avertissement",
  blocked: "Vinted a bloqué l'accès",
  rate_limited: "Vinted a répondu « trop de requêtes »",
  interrupted: "Action interrompue (arrêt du serveur) : résultat à vérifier dans Vinted",
  restored: "Données restaurées depuis une sauvegarde : reconnectez-vous puis reprenez",
};

export function isVintedPauseReason(reason: string | null | undefined): reason is (typeof CLOUD_VINTED_PAUSE_REASONS)[number] {
  return (CLOUD_VINTED_PAUSE_REASONS as readonly string[]).includes(reason ?? "");
}

/** Niveau d'une action : légère (autorisée sur l'adresse partagée) ou lourde (derrière CLOUD_HEAVY_ACTIONS, à décider). */
export const CLOUD_ACTION_LEVELS = ["light", "heavy"] as const;
export const cloudActionLevel = z.enum(CLOUD_ACTION_LEVELS);
export type CloudActionLevel = z.infer<typeof cloudActionLevel>;

export const CLOUD_ACTION_LEVEL_LABELS: Record<CloudActionLevel, string> = {
  light: "Action légère (répondre, relancer)",
  heavy: "Action lourde (republier, modifier en masse) — à décider",
};

/** Sortes d'actions (mêmes noms que l'exécuteur de navigateur, paquet @selio/cloud). */
export const CLOUD_ACTION_KINDS = ["reply", "follow_up", "republish", "bulk_edit"] as const;
export const cloudActionKind = z.enum(CLOUD_ACTION_KINDS);
export type CloudActionKind = z.infer<typeof cloudActionKind>;

export const CLOUD_ACTION_LEVEL_BY_KIND: Record<CloudActionKind, CloudActionLevel> = {
  reply: "light",
  follow_up: "light",
  republish: "heavy",
  bulk_edit: "heavy",
};

export const CLOUD_ACTION_KIND_LABELS: Record<CloudActionKind, string> = {
  reply: "Réponse à un message",
  follow_up: "Relance après 24 h",
  republish: "Republication",
  bulk_edit: "Modification en masse",
};

/**
 * Règles d'automatisation que le Cloud sait exécuter au lancement (actions légères seulement) et
 * l'action correspondante. Les autres règles restent sur le serveur ou l'extension.
 */
export const CLOUD_RULE_ACTIONS: Partial<Record<RuleKind, CloudActionKind>> = {
  reply_on_new_message: "reply",
  follow_up_no_reply: "follow_up",
};

export const CLOUD_ACTION_STATUSES = ["queued", "running", "done", "failed", "skipped", "paused"] as const;
export const cloudActionStatus = z.enum(CLOUD_ACTION_STATUSES);
export type CloudActionStatus = z.infer<typeof cloudActionStatus>;

export const CLOUD_ACTION_STATUS_LABELS: Record<CloudActionStatus, string> = {
  queued: "En attente",
  running: "En cours",
  done: "Faite",
  failed: "Échouée",
  skipped: "Ignorée",
  paused: "Interrompue (compte en pause)",
};

/**
 * Résultat renvoyé par l'exécuteur après une action : « ok », un signal de Vinted (CAPTCHA,
 * avertissement, blocage, trop de requêtes → pause du compte), une session expirée
 * (→ connexion à refaire), une erreur technique, ou « unavailable » : aucun navigateur n'a pu être
 * lancé (créneaux occupés, Chromium en panne) — rien n'a touché Vinted, la tâche est remise en file
 * sans compter dans les plafonds.
 */
export const CLOUD_RUN_CODES = ["ok", "captcha", "warning", "blocked", "rate_limited", "not_logged_in", "selector_missing", "timeout", "error", "unavailable"] as const;
export const cloudRunCode = z.enum(CLOUD_RUN_CODES);
export type CloudRunCode = z.infer<typeof cloudRunCode>;

export const CLOUD_RUN_CODE_LABELS: Record<CloudRunCode, string> = {
  ok: "Action faite",
  captcha: "CAPTCHA affiché par Vinted",
  warning: "Avertissement de Vinted",
  blocked: "Accès bloqué par Vinted",
  rate_limited: "Trop de requêtes (Vinted)",
  not_logged_in: "Session expirée : connexion à refaire",
  selector_missing: "Page Vinted non reconnue",
  timeout: "Délai dépassé",
  error: "Erreur technique",
  unavailable: "Aucun navigateur libre : action remise en file",
};

export const CLOUD_LOGIN_SESSION_STATUSES = ["open", "done", "expired", "cancelled"] as const;
export const cloudLoginSessionStatus = z.enum(CLOUD_LOGIN_SESSION_STATUSES);
export type CloudLoginSessionStatus = z.infer<typeof cloudLoginSessionStatus>;

// ---------------------------------------------------------------- entités

export const cloudConsent = z.object({
  id,
  orgId: id,
  userId: id,
  version: z.string().min(1).max(40),
  /** Empreinte SHA-256 (hex) du texte accepté. */
  textHash: z.string().min(16).max(128),
  acceptedAt: isoDate,
  ip: z.string().max(64).nullable().default(null),
});
export type CloudConsent = z.infer<typeof cloudConsent>;

export const cloudAccountSettings = z.object({
  /** Niveaux d'action autorisés par le client ; « heavy » n'est acceptable que si le réglage serveur l'ouvre. */
  levels: z.array(cloudActionLevel).min(1).max(2).default(["light"]),
});
export type CloudAccountSettings = z.infer<typeof cloudAccountSettings>;

/** Compte Vinted activé dans le Cloud. Jamais le contenu de la session : seulement sa présence et sa date. */
export const cloudAccount = z.object({
  id,
  orgId: id,
  connectionId: id,
  status: cloudAccountStatus.default("needs_login"),
  pausedReason: cloudPauseReason.nullable().default(null),
  pausedAt: isoDate.nullable().default(null),
  hasSession: z.boolean().default(false),
  sessionSavedAt: isoDate.nullable().default(null),
  lastActionAt: isoDate.nullable().default(null),
  /** Signaux de Vinted reçus depuis l'activation (CAPTCHA, avertissement, blocage, trop de requêtes). */
  warningsCount: z.number().int().min(0).default(0),
  settings: cloudAccountSettings.default({}),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type CloudAccount = z.infer<typeof cloudAccount>;

/**
 * Détail d'une action du journal : jamais de secret, jamais le texte du message — seulement la
 * référence de conversation, la longueur du message, le code et la durée. Les clés sont fermées.
 */
export const cloudActionDetail = z
  .object({
    conversationRef: z.string().max(120).nullable().optional(),
    conversationId: id.nullable().optional(),
    messageLength: z.number().int().min(0).optional(),
    code: cloudRunCode.optional(),
    durationMs: z.number().int().min(0).optional(),
    /** Message court et technique (sans donnée personnelle), ex. « session expirée ». */
    message: z.string().max(200).optional(),
    /** Raison d'une action ignorée par le planificateur. */
    reason: z.string().max(60).optional(),
    /** « unknown » : le clic a pu avoir lieu sans confirmation ; rien n'est renvoyé automatiquement. */
    sideEffects: z.enum(["none", "unknown"]).optional(),
    ruleName: z.string().max(120).optional(),
  })
  .strict();
export type CloudActionDetail = z.infer<typeof cloudActionDetail>;

export const cloudAction = z.object({
  id,
  orgId: id,
  accountId: id,
  kind: cloudActionKind,
  level: cloudActionLevel,
  status: cloudActionStatus,
  detail: cloudActionDetail.default({}),
  jobId: id.nullable().default(null),
  startedAt: isoDate.nullable().default(null),
  finishedAt: isoDate.nullable().default(null),
  createdAt: isoDate,
});
export type CloudAction = z.infer<typeof cloudAction>;

/** Fenêtre de connexion : le ticket (secret) n'est renvoyé qu'une fois, seule son empreinte est en base. */
export const cloudLoginSession = z.object({
  id,
  orgId: id,
  accountId: id,
  status: cloudLoginSessionStatus.default("open"),
  /** Ticket consommé : une seule WebSocket par fenêtre, jamais une seconde (ticket à usage unique). */
  attachedAt: isoDate.nullable().default(null),
  expiresAt: isoDate,
  createdAt: isoDate,
});
export type CloudLoginSession = z.infer<typeof cloudLoginSession>;

/** Ce que reçoit le client quand il ouvre une fenêtre de connexion (le ticket n'est jamais réaffiché). */
export const cloudLoginTicket = z.object({
  loginSessionId: id,
  ticket: z.string().min(20),
  expiresAt: isoDate,
});
export type CloudLoginTicket = z.infer<typeof cloudLoginTicket>;

/**
 * Session de navigateur telle que Playwright l'exporte (`storageState`), restreinte aux domaines
 * vinted.* avant chiffrement. Ce schéma ne sert qu'au serveur et à l'exécuteur : il ne traverse
 * jamais l'API publique.
 */
export const cloudStorageCookie = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(8192),
  domain: z.string().min(1).max(253),
  path: z.string().max(1024).default("/"),
  /** Horodatage Unix en secondes ; -1 pour un cookie de session. */
  expires: z.number().finite().default(-1),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
});
/** Champs inconnus retirés (aucune autre extension du format n'est gardée). */
export const cloudStorageState = z.object({
  cookies: z.array(cloudStorageCookie).max(2000).default([]),
  origins: z
    .array(
      z.object({
        origin: z.string().min(1).max(2048),
        localStorage: z.array(z.object({ name: z.string().max(1024), value: z.string().max(1_000_000) })).max(500).default([]),
      }),
    )
    .max(200)
    .default([]),
});
export type CloudStorageState = z.infer<typeof cloudStorageState>;

/**
 * Aucune collecte globale : seuls les cookies et le stockage local des domaines de Vinted (liste
 * fermée `VINTED_DOMAINS`) sont gardés, champs connus seulement, et jamais les cookies de passage
 * d'un service anti-robot (`isAntiBotCookie` : une vérification humaine ne sert pas de laissez-passer
 * au robot). Une entrée illisible donne une session vide (jamais d'exception qui recopierait la
 * valeur dans un message d'erreur).
 */
export function filterVintedStorageState(raw: unknown): CloudStorageState {
  const parsed = cloudStorageState.safeParse(raw ?? {});
  if (!parsed.success) return { cookies: [], origins: [] };
  return {
    cookies: parsed.data.cookies.filter((c) => isVintedHost(c.domain) && !isAntiBotCookie(c.name)),
    origins: parsed.data.origins.filter((o) => isVintedOrigin(o.origin)),
  };
}

export function isStorageStateEmpty(state: CloudStorageState | null | undefined): boolean {
  return !state || (state.cookies.length === 0 && state.origins.length === 0);
}

// ---------------------------------------------------------------- disponibilité et planification

/**
 * Le Cloud selon l'offre : compris dans Agence (`quotas.cloudIncluded`), « en option, prix à décider »
 * pour Pro (réglage préparé, rien facturé), indisponible en Accès de base et Starter.
 */
export const cloudAvailability = z.object({
  plan: z.string(),
  included: z.boolean(),
  optional: z.boolean(),
  available: z.boolean(),
  reason: z.string(),
  /** Plafond d'actions par jour (automationActionsPerDay du plan). */
  actionsPerDay: z.number().int().min(0),
  maxAccounts: z.number().int().min(0),
  /** Actions lourdes ouvertes par le réglage serveur (CLOUD_HEAVY_ACTIONS), sinon « à décider par Ibrahim ». */
  heavyActionsEnabled: z.boolean(),
  /** Navigateurs ouverts en même temps sur la machine (CLOUD_MAX_BROWSERS). */
  maxBrowsers: z.number().int().min(1),
  /** Mention honnête sur la capacité : la cible de 50 navigateurs n'est pas encore mesurée. */
  capacityNote: z.string(),
});
export type CloudAvailability = z.infer<typeof cloudAvailability>;

export const CLOUD_SKIP_REASONS = [
  "expired",
  "no_session",
  "no_consent",
  "global_pause",
  "account_not_active",
  "plan_unavailable",
  "level_not_allowed",
  "heavy_disabled",
  "outside_active_hours",
  "daily_limit",
  "hourly_limit",
  "too_soon",
  // Raisons d'une tâche écartée au moment d'agir (journal) :
  "no_cloud_account",
  "personal_account",
  "account_mismatch",
  "conversation_unknown",
  "empty_message",
  "over_account_limit",
  "machine_paused",
] as const;
export type CloudSkipReason = (typeof CLOUD_SKIP_REASONS)[number];

export const CLOUD_SKIP_REASON_LABELS: Record<CloudSkipReason, string> = {
  expired: "Tâche trop ancienne (plus de 24 h) : ignorée plutôt qu'exécutée en retard",
  no_session: "Aucune session enregistrée : connexion à refaire",
  no_consent: "Accord Cloud manquant ou périmé",
  global_pause: "Arrêt global des automatisations",
  account_not_active: "Compte Cloud non actif",
  plan_unavailable: "Cloud non compris dans l'offre",
  level_not_allowed: "Niveau d'action non autorisé sur ce compte",
  heavy_disabled: "Actions lourdes non ouvertes (à décider)",
  outside_active_hours: "Hors heures actives",
  daily_limit: "Plafond journalier atteint",
  hourly_limit: "Plafond horaire atteint",
  too_soon: "Délai entre deux actions non écoulé",
  no_cloud_account: "Compte Cloud arrêté ou supprimé",
  personal_account: "Compte Perso : jamais utilisé par les automatisations",
  account_mismatch: "La conversation n'appartient pas à ce compte Cloud",
  conversation_unknown: "Conversation Vinted inconnue (référence manquante)",
  empty_message: "Message vide : rien à envoyer",
  over_account_limit: "Compte au-delà du nombre de comptes Cloud de l'offre",
  machine_paused: "Cloud suspendu sur la machine après un signal de Vinted (adresse partagée)",
};

// ---------------------------------------------------------------- entrées

export const cloudEnableAccountInput = z.object({ connectionId: id }).strict();
export type CloudEnableAccountInput = z.infer<typeof cloudEnableAccountInput>;

export const cloudUpdateSettingsInput = z.object({ levels: z.array(cloudActionLevel).min(1).max(2) }).strict();
export type CloudUpdateSettingsInput = z.infer<typeof cloudUpdateSettingsInput>;

export const cloudAcceptConsentInput = z.object({ version: z.string().min(1).max(40), accepted: z.literal(true) }).strict();
export type CloudAcceptConsentInput = z.infer<typeof cloudAcceptConsentInput>;

/** Reprise après une pause venue de Vinted : le client acquitte explicitement l'avertissement. */
export const cloudResumeInput = z.object({ acknowledge: z.boolean().default(false) });
export type CloudResumeInput = z.input<typeof cloudResumeInput>;

export const cloudJournalQuery = z.object({
  kind: cloudActionKind.optional(),
  status: cloudActionStatus.optional(),
  accountId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type CloudJournalQuery = z.infer<typeof cloudJournalQuery>;

/** Écran d'accord : texte courant, version, dernier accord enregistré et validité pour la version courante. */
export const cloudConsentView = z.object({
  version: z.string(),
  text: z.string(),
  accepted: cloudConsent.nullable(),
  /** Vrai si l'accord enregistré porte sur la version et le texte courants. */
  current: z.boolean(),
});
export type CloudConsentView = z.infer<typeof cloudConsentView>;
