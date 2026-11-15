import { describe, expect, it } from "vitest";
import { BOT_AUTO_BUY_LOCKED_TEXT, BOT_IDS, RULE_KINDS, quotasForPlan } from "@selio/contracts";
import { botActionStatus, botForRuleKind, describeBots, type BotInputs } from "./bot";

const closedAutoBuy: BotInputs["autoBuy"] = { serverEnabled: false, realPurchase: false, orgEnabled: false, active: false, threshold: 85, dailyCapCents: 15_000, maxItemCents: 6_000, reasons: ["Radar Auto est désactivé sur ce serveur."], notice: "" };
const noCloud: BotInputs["cloud"] = { available: false, serverEnabled: false, ready: false, reason: "Selio Cloud n'est pas disponible avec l'offre Pro.", activeHours: { startHour: 8, endHour: 23 } };

function inputs(over: Partial<BotInputs> = {}): BotInputs {
  return { rules: [], plan: "pro", quotas: quotasForPlan("pro"), cloud: noCloud, stopped: false, autoBuy: closedAutoBuy, ...over };
}
const byId = (views: ReturnType<typeof describeBots>) => Object.fromEntries(views.map((v) => [v.id, v]));

describe("Selio Bot : vues des bots (fonction pure)", () => {
  it("sept bots, dans l'ordre ; chaque règle existante appartient à un bot au plus", () => {
    expect(describeBots(inputs()).map((b) => b.id)).toEqual([...BOT_IDS]);
    const owners = RULE_KINDS.map(botForRuleKind);
    expect(owners.every((o) => o !== null)).toBe(true);
    expect(botForRuleKind("auto_negotiate")).toBe("negotiation");
    expect(botForRuleKind("follow_up_24h")).toBe("follow_up");
    expect(botForRuleKind("keyword_situation")).toBe("replies");
  });

  it("sans règle : arrêtés ; Favoris « bientôt » avec une phrase ; achat auto verrouillé avec la phrase de validation juridique", () => {
    const b = byId(describeBots(inputs()));
    expect(b.negotiation!.state).toBe("off");
    expect(b.favorites!.state).toBe("soon");
    expect(b.favorites!.stateDetail).toMatch(/aucun message n'est envoyé/);
    expect(b.auto_buy!.state).toBe("locked");
    expect(b.auto_buy!.stateDetail).toBe(BOT_AUTO_BUY_LOCKED_TEXT);
    expect(b.auto_buy!.planLimit).toMatch(/150,00 € par jour.*60,00 €.*85\/100/);
  });

  it("règles actives : allumés, et « Tout arrêter » les coupe tous (achat assisté conservé)", () => {
    const rules = [{ kind: "auto_negotiate" as const, enabled: true }, { kind: "reply_on_new_message" as const, enabled: true }, { kind: "post_sale_message" as const, enabled: true }];
    const on = byId(describeBots(inputs({ rules })));
    expect(on.negotiation!.state).toBe("on");
    expect(on.negotiation!.place).toBe("extension");
    expect(on.replies!.place).toBe("extension");
    expect(on.after_sale!.rulesEnabled).toBe(1);
    const stopped = byId(describeBots(inputs({ rules, stopped: true })));
    for (const id of ["negotiation", "replies", "after_sale"]) expect(stopped[id]!.state).toBe("stopped");
    expect(stopped.auto_buy!.state).toBe("stopped");
    expect(stopped.auto_buy!.stateDetail).toMatch(/achat assisté reste disponible/);
  });

  it("relance 24 h : indisponible en Starter, brouillons en Pro, Selio Cloud en Agence ou en attente du Cloud", () => {
    const rules = [{ kind: "follow_up_24h" as const, enabled: true }];
    expect(byId(describeBots(inputs({ rules, plan: "starter", quotas: quotasForPlan("starter") }))).follow_up!.state).toBe("plan_unavailable");
    const pro = byId(describeBots(inputs({ rules }))).follow_up!;
    expect(pro.state).toBe("on");
    expect(pro.place).toBe("server");
    const agence = { plan: "agence", quotas: quotasForPlan("agence"), rules };
    const waiting = byId(describeBots(inputs({ ...agence, cloud: { ...noCloud, available: true, serverEnabled: false } }))).follow_up!;
    expect(waiting.state).toBe("waiting_cloud");
    expect(waiting.stateDetail).toMatch(/pas encore ouvert sur ce serveur/);
    const ready = byId(describeBots(inputs({ ...agence, cloud: { ...noCloud, available: true, serverEnabled: true, ready: true } })));
    expect(ready.follow_up!.state).toBe("on");
    expect(ready.follow_up!.place).toBe("cloud");
    expect(ready.follow_up!.placeDetail).toMatch(/de 8 h à 23 h/);
    expect(ready.replies!.place).toBe("cloud");
  });

  it("achat auto : actif (essai à blanc dit), arrêté dans ses réglages, ou en attente du Cloud", () => {
    const open = { ...closedAutoBuy, serverEnabled: true };
    expect(byId(describeBots(inputs({ autoBuy: { ...open, orgEnabled: true, active: true } }))).auto_buy!.stateDetail).toMatch(/s'arrête avant le paiement/);
    expect(byId(describeBots(inputs({ autoBuy: open }))).auto_buy!.state).toBe("off");
    const waiting = byId(describeBots(inputs({ autoBuy: { ...open, orgEnabled: true, reasons: ["Compte Achat sans Selio Cloud."] } }))).auto_buy!;
    expect(waiting.state).toBe("waiting_cloud");
    expect(waiting.stateDetail).toBe("Compte Achat sans Selio Cloud.");
  });

  it("statut d'une tâche vu comme une action", () => {
    expect(botActionStatus("succeeded")).toBe("done");
    expect(botActionStatus("awaiting_approval")).toBe("pending");
    expect(botActionStatus("cancelled")).toBe("skipped");
    expect(botActionStatus("failed")).toBe("failed");
  });
});
