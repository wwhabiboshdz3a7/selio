import {
  BOT_AUTO_BUY_LOCKED_TEXT, BOT_IDS, PLAN_LABELS, isPlan,
  type AutomationRule, type BotAction, type BotId, type BotLink, type BotPlace, type BotState, type BotSummary, type BotView, type JobStatus, type PlanQuotas, type RuleKind,
} from "@selio/contracts";
import { centsToDecimalString } from "./money";

/**
 * Selio Bot (fonctions pures, partagées par le cœur et la démonstration) : chaque bot regroupe des
 * automatisations qui existent déjà (règles, réglages, Radar Auto) et dit honnêtement son état et où il
 * tourne. Aucun bot n'invente d'action : un bot non construit est « bientôt », avec une phrase.
 */

const RULES_LINK: BotLink = { to: "/app/automations", label: "Règles, horaires et file des tâches" };

interface BotDef {
  name: string;
  description: string;
  ruleKinds: RuleKind[];
  settings: BotLink[];
}

export const BOT_DEFS: Record<BotId, BotDef> = {
  negotiation: {
    name: "Négociation par IA",
    description: "Répond aux offres des acheteurs selon vos planchers et vos paliers : accepte, contre-propose ou refuse, jamais sous le plancher.",
    ruleKinds: ["auto_negotiate"],
    settings: [{ to: "/app/automatisation/negociation", label: "Planchers, paliers et messages" }, RULES_LINK],
  },
  follow_up: {
    name: "Relances",
    description: "Relance une seule fois l'acheteur resté sans réponse, sans chiffre ni « dernier prix ».",
    ruleKinds: ["follow_up_24h", "follow_up_no_reply"],
    settings: [{ to: "/app/automatisation/negociation", label: "Texte de la relance" }, RULES_LINK],
  },
  republish: {
    name: "Republication",
    description: "Remonte les articles dormants du dressing : remise en avant, et baisse de prix jamais sous le plancher.",
    ruleKinds: ["relist_stale", "price_drop_stale"],
    settings: [{ to: "/app/dressing", label: "Dressing intelligent" }, { to: "/app/automatisation/stock", label: "Stock automatique" }, RULES_LINK],
  },
  replies: {
    name: "Réponses aux messages",
    description: "Répond aux nouveaux messages et aux situations reconnues par mots-clés, à partir de vos gabarits.",
    ruleKinds: ["reply_on_new_message", "keyword_situation"],
    settings: [{ to: "/app/automatisation/reponse", label: "Réponses et situations" }, RULES_LINK],
  },
  favorites: {
    name: "Messages aux favoris",
    description: "Écrira aux personnes qui mettent un article en favori, avec une petite remise.",
    ruleKinds: [],
    settings: [{ to: "/app/automatisation/favoris", label: "Message et remise" }],
  },
  auto_buy: {
    name: "Achat automatique (Selio Bot)",
    description: "Achète seul au-dessus d'une note, dans un budget par jour ; sinon l'achat rapide vous propose chaque affaire à valider en 1 clic.",
    ruleKinds: [],
    settings: [{ to: "/bot/achat-auto", label: "Verrous, budget et note minimale" }, { to: "/app/purchase", label: "Affaires à valider" }, { to: "/app/radar", label: "Bonnes affaires" }],
  },
  after_sale: {
    name: "Après-vente",
    description: "Écrit à l'acheteur après la vente (remerciement, envoi du colis).",
    ruleKinds: ["post_sale_message"],
    settings: [{ to: "/app/automatisation/apres-vente", label: "Messages après-vente" }, RULES_LINK],
  },
};

/** Bot qui regroupe une règle d'automatisation (null : aucune). */
export function botForRuleKind(kind: RuleKind): BotId | null {
  return BOT_IDS.find((id) => BOT_DEFS[id].ruleKinds.includes(kind)) ?? null;
}

/** Statut d'une tâche (`jobs`) vu comme une action de bot. */
export function botActionStatus(status: JobStatus): BotAction["status"] {
  if (status === "succeeded") return "done";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "skipped") return "skipped";
  return "pending";
}

export interface BotInputs {
  rules: readonly Pick<AutomationRule, "kind" | "enabled">[];
  plan: string;
  quotas: Pick<PlanQuotas, "followUp24h" | "automationActionsPerDay">;
  cloud: Pick<BotSummary["cloud"], "available" | "serverEnabled" | "ready" | "reason" | "activeHours">;
  stopped: boolean;
  autoBuy: BotSummary["autoBuy"];
  recent?: Partial<Record<BotId, BotAction[]>>;
}

const euros = (cents: number) => `${centsToDecimalString(cents)} €`;

function cloudPlace(cloud: BotInputs["cloud"]): string {
  return `ordinateur éteint, de ${cloud.activeHours.startHour} h à ${cloud.activeHours.endHour} h, au rythme humain.`;
}

const EXTENSION_PLACE = "ordinateur allumé et Vinted ouvert.";
const DRAFTS_PLACE = "brouillons à valider dans Messages ; vous les envoyez.";

/** Pourquoi Selio Cloud ne prend pas le relais (forfait, serveur, compte, accord). */
export function cloudWaitReason(cloud: BotInputs["cloud"]): string {
  if (!cloud.available) return "Selio Cloud n'est pas compris dans ce forfait (compris en Agence).";
  if (cloud.serverEnabled === false) return "Selio Cloud est en cours d'ouverture sur ce serveur, progressivement.";
  return "Aucun compte Vinted actif dans Selio Cloud (accord, connexion ou compte en pause).";
}

/** Vues des bots (fonction pure) : état, lieu d'exécution, réglages existants, limite du forfait, dernières actions. */
export function describeBots(input: BotInputs): BotView[] {
  const planLabel = isPlan(input.plan) ? PLAN_LABELS[input.plan] : input.plan;
  const perDay = `${input.quotas.automationActionsPerDay} actions automatiques par jour (offre ${planLabel}).`;
  return BOT_IDS.map((id): BotView => {
    const def = BOT_DEFS[id];
    const kinds = def.ruleKinds;
    const own = input.rules.filter((r) => kinds.includes(r.kind));
    const enabled = own.filter((r) => r.enabled);
    const base = { id, name: def.name, description: def.description, ruleKinds: kinds, rulesEnabled: enabled.length, rulesTotal: own.length, settings: def.settings, recent: (input.recent?.[id] ?? []).slice(0, 5) };
    const view = (state: BotState, stateDetail: string, place: BotPlace, placeDetail: string, planLimit: string = perDay): BotView => ({ ...base, state, stateDetail, place, placeDetail, planLimit });
    /** Règle allumée : coupée par « Tout arrêter », sinon allumée. */
    const running = (detail: string, place: BotPlace, placeDetail: string, planLimit?: string): BotView =>
      input.stopped ? view("stopped", "Coupé par « Arrêter toutes les automatisations » : rien ne part jusqu'à la reprise.", place, placeDetail, planLimit) : view("on", detail, place, placeDetail, planLimit);
    const off = (place: BotPlace, placeDetail: string, planLimit?: string) => view("off", own.length === 0 ? "Aucune règle créée : réglez-le, puis allumez-le." : "Règles arrêtées : allumez-en une pour qu'il agisse.", place, placeDetail, planLimit);

    switch (id) {
      case "negotiation": {
        const place = "décision calculée sur le serveur selon vos planchers ; envoi par l'extension, ordinateur allumé (Selio Cloud ne négocie pas : actions légères seulement sur l'adresse partagée).";
        return enabled.length === 0 ? off("extension", place) : running("Il traite chaque nouvelle offre selon vos planchers.", "extension", place);
      }
      case "replies": {
        const place = input.cloud.ready ? `${cloudPlace(input.cloud)} Sans compte actif dans le Cloud, par l'extension.` : `${EXTENSION_PLACE} ${cloudWaitReason(input.cloud)}`;
        return enabled.length === 0 ? off(input.cloud.ready ? "cloud" : "extension", place) : running("Il répond aux nouveaux messages selon vos gabarits.", input.cloud.ready ? "cloud" : "extension", place);
      }
      case "follow_up": {
        const mode = input.quotas.followUp24h;
        const on24 = enabled.some((r) => r.kind === "follow_up_24h");
        const modeText = mode === "auto" ? "Relance après 24 h envoyée par Selio Cloud (offre Agence)." : mode === "suggested" ? "Relance après 24 h préparée en brouillon à valider (offre Pro) ; envoi automatique avec l'offre Agence." : "Relance après 24 h comprise à partir de l'offre Pro.";
        const limit = `${modeText} ${perDay}`;
        if (mode === "none" && !enabled.some((r) => r.kind === "follow_up_no_reply")) {
          return view("plan_unavailable", "La relance après 24 h est comprise à partir de l'offre Pro (brouillons à valider), envoyée seule par Selio Cloud en Agence.", "none", "aucune relance tant que le forfait ne la comprend pas.", limit);
        }
        if (enabled.length === 0) return off(mode === "auto" && input.cloud.ready ? "cloud" : "server", mode === "auto" && input.cloud.ready ? cloudPlace(input.cloud) : DRAFTS_PLACE, limit);
        if (on24 && mode === "auto") {
          if (input.cloud.ready) return running("Il relance une fois chaque acheteur resté sans réponse.", "cloud", cloudPlace(input.cloud), limit);
          if (input.stopped) return view("stopped", "Coupé par « Arrêter toutes les automatisations » : rien ne part jusqu'à la reprise.", "server", DRAFTS_PLACE, limit);
          return view("waiting_cloud", `${cloudWaitReason(input.cloud)} En attendant, chaque relance est préparée en brouillon à valider dans Messages.`, "server", "brouillons à valider dans Messages, en attendant Selio Cloud.", limit);
        }
        if (on24) return running("Il prépare une relance par acheteur sans réponse, à valider dans Messages.", "server", DRAFTS_PLACE, limit);
        return running("Il relance les conversations sans réponse selon votre règle.", input.cloud.ready ? "cloud" : "extension", input.cloud.ready ? cloudPlace(input.cloud) : EXTENSION_PLACE, limit);
      }
      case "republish": {
        const place = "ordinateur allumé ; la baisse de prix est calculée sur le serveur. La republication par Selio Cloud est une action lourde, fermée sur l'adresse partagée.";
        return enabled.length === 0 ? off("extension", place) : running("Il repère les articles dormants et prépare leur remontée.", "extension", place);
      }
      case "after_sale": {
        return enabled.length === 0 ? off("extension", EXTENSION_PLACE) : running("Il écrit à l'acheteur après chaque vente.", "extension", EXTENSION_PLACE);
      }
      case "favorites":
        return view("soon", "Les réglages existent (message et remise), mais Selio ne lit pas encore les mises en favori sur Vinted : aucun message n'est envoyé.", "none", "pas encore construit.", "—");
      case "auto_buy": {
        const a = input.autoBuy;
        const limit = `Budget de ${euros(a.dailyCapCents)} par jour, ${euros(a.maxItemCents)} au plus par article, note minimale ${a.threshold}/100.`;
        const assisted = "achat rapide : vous validez chaque affaire en 1 clic.";
        if (input.stopped) return view("stopped", "Achat automatique coupé par « Arrêter toutes les automatisations ». L'achat rapide reste disponible : vous validez chaque achat en 1 clic.", "none", assisted, limit);
        if (a.active) return view("on", a.realPurchase ? "Selio Bot achète seul les affaires au-dessus de la note minimale, dans le budget du jour." : "Selio Bot choisit seul, mais s'arrête avant le paiement (achat réel fermé) : chaque achat est enregistré « simulé ».", "cloud", `${cloudPlace(input.cloud)} Paiement par le porte-monnaie Vinted ; 3-D Secure validé par vous.`, limit);
        if (!a.serverEnabled) return view("locked", BOT_AUTO_BUY_LOCKED_TEXT, "none", assisted, limit);
        if (!a.orgEnabled) return view("off", "L'achat automatique est arrêté dans ses réglages : l'achat rapide vous propose chaque affaire à valider en 1 clic.", "none", assisted, limit);
        return view("waiting_cloud", a.reasons[0] ?? cloudWaitReason(input.cloud), "none", assisted, limit);
      }
    }
  });
}
