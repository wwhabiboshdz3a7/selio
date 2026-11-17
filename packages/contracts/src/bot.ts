import type { RuleKind } from "./automation";

/**
 * Selio Bot : les automatisations qui AGISSENT pour le revendeur (négocier, relancer, republier,
 * répondre, acheter, après-vente), présentées comme des bots qu'on allume, règle et surveille. Aucun
 * bot n'a de logique propre : chacun regroupe des règles d'automatisation existantes (`automation_rules`),
 * des réglages existants (`settings.automation`, `settings.autoBuy`) et Radar Auto. Ils s'exécutent dans
 * Selio Cloud (ordinateur éteint) quand le code le permet, sinon par l'extension (ordinateur allumé) ou
 * sur le serveur. Le coupe-circuit « Tout arrêter » est l'arrêt global des automatisations de
 * l'organisation (`automation_state.global_paused`), respecté par l'API et le worker avant chaque action.
 */
export const BOT_IDS = ["negotiation", "follow_up", "republish", "replies", "favorites", "auto_buy", "after_sale"] as const;
export type BotId = (typeof BOT_IDS)[number];

/**
 * État d'un bot :
 * - `on` : allumé, il agit au prochain passage ;
 * - `off` : arrêté (aucune règle active, ou réglage désactivé) ;
 * - `stopped` : coupé par « Tout arrêter » (coupe-circuit de l'organisation) ;
 * - `waiting_cloud` : allumé, mais il attend Selio Cloud (serveur fermé, aucun compte actif, accord) ;
 * - `locked` : verrou serveur fermé (achat automatique : validation juridique attendue) ;
 * - `plan_unavailable` : indisponible sur ce forfait ;
 * - `soon` : pas encore construit (une phrase dit pourquoi).
 */
export const BOT_STATES = ["on", "off", "stopped", "waiting_cloud", "locked", "plan_unavailable", "soon"] as const;
export type BotState = (typeof BOT_STATES)[number];

export const BOT_STATE_LABELS: Record<BotState, string> = {
  on: "Allumé",
  off: "Arrêté",
  stopped: "Tout arrêté",
  waiting_cloud: "En attente de Selio Cloud",
  locked: "Verrouillé",
  plan_unavailable: "Indisponible sur ce forfait",
  soon: "Bientôt",
};

/** Où le bot agit : Selio Cloud (ordinateur éteint), l'extension (ordinateur allumé), le serveur Selio, ou nulle part. */
export const BOT_PLACES = ["cloud", "extension", "server", "none"] as const;
export type BotPlace = (typeof BOT_PLACES)[number];

export const BOT_PLACE_LABELS: Record<BotPlace, string> = {
  cloud: "Selio Cloud",
  extension: "Extension",
  server: "Serveur Selio",
  none: "Aucun automatisme",
};

/** Dernière action d'un bot, lue dans les journaux existants (tâches, journal Cloud, demandes d'achat). */
export interface BotAction {
  at: string;
  label: string;
  /** done : faite ; pending : en file ou à valider ; failed : en échec ; skipped : écartée ou annulée. */
  status: "done" | "pending" | "failed" | "skipped";
  source: "job" | "cloud" | "purchase" | "activity";
}

export interface BotLink { to: string; label: string }

export interface BotView {
  id: BotId;
  name: string;
  /** Ce que fait le bot, en une phrase. */
  description: string;
  state: BotState;
  /** Pourquoi cet état, en français simple. */
  stateDetail: string;
  place: BotPlace;
  /** Où il tourne, en clair (« Selio Cloud, ordinateur éteint, de 8 h à 23 h »). */
  placeDetail: string;
  /** Règles d'automatisation regroupées par ce bot (vide : réglages seulement, ou Radar Auto). */
  ruleKinds: RuleKind[];
  rulesEnabled: number;
  rulesTotal: number;
  /** Réglages existants (pages des automatisations, Radar Auto) : jamais dupliqués dans le Bot. */
  settings: BotLink[];
  /** Limite du forfait qui s'applique, en clair. */
  planLimit: string;
  recent: BotAction[];
}

/** Synthèse de Selio Bot (GET /api/bot). */
export interface BotSummary {
  /** Coupe-circuit de l'organisation (« Tout arrêter ») : aucune action automatique tant qu'il est actif. */
  stopped: boolean;
  stoppedAt: string | null;
  /** Titulaire et administrateur : tout arrêter et reprendre. Les autres rôles voient l'état. */
  canManage: boolean;
  plan: string;
  /** Actions automatiques réussies aujourd'hui (jour de l'organisation), face au plafond du forfait. */
  actionsToday: number;
  actionsPerDay: number;
  cloud: {
    /** Le forfait permet Selio Cloud (Agence, ou option Pro ouverte). */
    available: boolean;
    /** Cloud ouvert sur ce serveur (CLOUD_ENABLED) ; null : inconnu (démonstration). */
    serverEnabled: boolean | null;
    reason: string;
    /** Comptes Cloud actifs avec une session, sur les comptes reliés. */
    activeAccounts: number;
    accounts: number;
    consent: boolean;
    /** Selio Cloud peut agir maintenant (forfait, serveur, accord et au moins un compte actif). */
    ready: boolean;
    activeHours: { startHour: number; endHour: number };
  };
  autoBuy: {
    /** Verrou serveur (RADAR_AUTO_ENABLED et comptes de l'équipe). */
    serverEnabled: boolean;
    /** Achat réel (RADAR_REAL_PURCHASE) : sinon arrêt avant le paiement, achat « simulé ». */
    realPurchase: boolean;
    orgEnabled: boolean;
    /** Tous les verrous levés : Radar Auto peut acheter au prochain passage. */
    active: boolean;
    threshold: number;
    dailyCapCents: number;
    maxItemCents: number;
    reasons: string[];
    notice: string;
  };
  bots: BotView[];
  /** Démonstration : rien n'est envoyé ni acheté. */
  simulated?: boolean;
}

/** Phrase du Bot quand les verrous serveur de l'achat automatique sont fermés. */
export const BOT_AUTO_BUY_LOCKED_TEXT = "L'achat automatique s'ouvrira après validation juridique ; en attendant, l'achat rapide vous propose chaque affaire à valider en 1 clic.";

/** Ce que coupe « Arrêter toutes les automatisations » (texte du bouton de confirmation et de BOT.md). */
export const BOT_STOP_TEXT = "Toutes les automatisations s'arrêtent pour toute l'organisation : plus aucune réponse, relance, négociation, republication, ni lecture en direct ou achat automatique de Selio Bot, dans Selio Cloud comme sur le serveur. Les tâches en file attendent la reprise ; une action déjà commencée se termine proprement.";
