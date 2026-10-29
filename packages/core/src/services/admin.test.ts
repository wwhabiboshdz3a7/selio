import { describe, expect, it } from "vitest";
import { quotasForPlan } from "@selio/contracts";
import { orgUsageFrom, type AdminOrgUsageRow } from "./admin";

const row = (over: Partial<AdminOrgUsageRow> = {}): AdminOrgUsageRow => ({
  id: "org-1",
  name: "Boutique A",
  plan: "pro",
  status: "trialing",
  quotas: quotasForPlan("pro"),
  createdAt: "2026-09-01T00:00:00.000Z",
  members: 2,
  items: 120,
  connections: 2,
  monthUsage: { "ai.request": 1200, "studio.listing": 16, "automation.action": 40 },
  cloudToday: 0,
  aiRequestsMonth: 1200,
  // Réglage de l'organisation à 0 : la limite du plan s'applique seule.
  aiSettings: { monthlyRequestQuota: 0 },
  ...over,
});

describe("administration : utilisation par client (fonction pure)", () => {
  it("Pro : compteurs du mois, pourcentage du compteur le plus avancé et alerte à 80 %", () => {
    const u = orgUsageFrom(row());
    expect(u).toMatchObject({ id: "org-1", plan: "pro", status: "trialing", automationActions: 40 });
    expect(u.counters.aiRequests).toEqual({ used: 1200, quota: 1500, percent: 80, warning: true, exceeded: false });
    expect(u.counters.connections).toMatchObject({ used: 2, quota: 3, percent: 67 });
    expect(u.studio.listings).toMatchObject({ used: 16, quota: 20, percent: 80, warning: true });
    expect(u.track.scans).toMatchObject({ used: 0, quota: 10, percent: 0 });
    expect(u.cloud).toMatchObject({ actions: { used: 0, quota: 500 }, included: false });
    expect(u.maxPercent).toBe(80);
    expect(u.warning).toBe(true);
    expect(u.exceeded).toBe(false);
  });

  it("compteur IA : même décompte et même limite que le refus (ai_requests, hors aide, plan ∧ réglage de l'organisation)", () => {
    // Réglage de l'organisation à 500 (défaut à l'inscription) : la limite effective est 500, pas 1 500.
    // 500 requêtes enregistrées (dont des échecs), 480 succès en usage_events : le compteur dit « atteint ».
    const u = orgUsageFrom(row({ aiRequestsMonth: 500, aiSettings: { monthlyRequestQuota: 500 }, monthUsage: { "ai.request": 480 } }));
    expect(u.counters.aiRequests).toEqual({ used: 500, quota: 500, percent: 100, warning: true, exceeded: true });
    expect(u.exceeded).toBe(true);
    // Réglage absent en base : défaut du schéma (500), comme à la lecture de l'organisation.
    expect(orgUsageFrom(row({ aiSettings: {} })).counters.aiRequests.quota).toBe(500);
    // Réglage plus large que le plan : le plan borne.
    expect(orgUsageFrom(row({ aiSettings: { monthlyRequestQuota: 9000 } })).counters.aiRequests.quota).toBe(1500);
    // Réglage illisible : défaut du schéma plutôt qu'un plantage.
    expect(orgUsageFrom(row({ aiSettings: { monthlyRequestQuota: "beaucoup" } })).counters.aiRequests.quota).toBe(500);
  });

  it("ancien JSON de quotas (sans les champs par filiale) : les quotas du plan s'appliquent, Studio retrouvé pour un Pro", () => {
    const legacy = { items: 5000, aiRequestsPerMonth: 3000, automationActionsPerDay: 500, connections: 5, members: 10 };
    const pro = orgUsageFrom(row({ quotas: legacy, monthUsage: {}, aiRequestsMonth: 0, connections: 3, members: 3 }));
    expect(pro.counters.aiRequests.quota).toBe(1500);
    expect(pro.counters.connections).toMatchObject({ used: 3, quota: 3, exceeded: true });
    expect(pro.studio.listings).toMatchObject({ used: 0, quota: 20 });
    const starter = orgUsageFrom(row({ plan: "starter", quotas: { items: 500, aiRequestsPerMonth: 500, automationActionsPerDay: 100, connections: 2, members: 3 }, monthUsage: {}, aiRequestsMonth: 0, items: 0, connections: 0, members: 0 }));
    expect(starter.counters.aiRequests.quota).toBe(300);
    expect(starter.counters.connections.quota).toBe(1);
    expect(starter.studio.listings).toEqual({ used: 0, quota: 0, percent: 0, warning: false, exceeded: true });
    // Fonction non incluse et rien d'utilisé : ni alerte ni dépassement signalés à l'opérateur.
    expect(starter.exceeded).toBe(false);
    expect(starter.warning).toBe(false);
    expect(starter.maxPercent).toBe(0);
  });

  it("organisation sans abonnement ou plan inconnu : accès de base, quotas du plan", () => {
    const u = orgUsageFrom(row({ plan: "essentiel", status: "none", quotas: {}, monthUsage: { "ai.request": 60 }, aiRequestsMonth: 60, items: 10, connections: 1, members: 1 }));
    expect(u.plan).toBe("free");
    expect(u.counters.aiRequests).toEqual({ used: 60, quota: 50, percent: 100, warning: true, exceeded: true });
    expect(u.exceeded).toBe(true);
    expect(u.maxPercent).toBe(100);
  });

  it("Agence : Cloud inclus, actions du jour rapportées au plafond journalier", () => {
    const u = orgUsageFrom(row({ plan: "agence", quotas: quotasForPlan("agence"), cloudToday: 1600, monthUsage: { "track.scan": 50 } }));
    expect(u.cloud).toEqual({ actions: { used: 1600, quota: 2000, percent: 80, warning: true, exceeded: false }, included: true });
    expect(u.track.scans).toMatchObject({ used: 50, quota: 50, exceeded: true });
    expect(u.exceeded).toBe(true);
  });
});
