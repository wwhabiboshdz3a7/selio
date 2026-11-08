import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { THRESHOLD_DISCLAIMER } from "@selio/domain";
import { DemoClient } from "./client";

/**
 * Négociation avancée, migration et fonctions « que Bleam n'a pas » dans la démonstration : mêmes
 * politiques que le serveur (@selio/domain), simulateur d'IA et validation de production pour la migration.
 * Heure fixée en journée (Europe/Paris) : la relance ne part jamais hors des heures actives.
 */
let now = new Date("2026-11-07T13:00:00Z");
let client: DemoClient;
beforeEach(async () => {
  now = new Date("2026-11-07T13:00:00Z");
  client = new DemoClient(new MemoryDemoStorage(), () => now);
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
});

const pasted = `Réglages exportés depuis Bleam
Remise max : 20 %
Marge minimum : 5 €
Horaires : 9h-21h
Couleur du thème : sombre
Mot de passe : hunter2`;

describe("migration (§5.13) : texte collé ou fichier RGPD, application des seuls champs cochés", () => {
  it("convertit, garde les inconnus à part, n'emporte jamais un secret, n'applique que ce qui est coché", async () => {
    const conv = await client.convertMigration({ text: pasted });
    expect(conv.via).toBe("ai");
    expect(conv.mapping.source).toBe("bleam");
    expect(conv.mapping.fields.map((f) => f.target)).toEqual(expect.arrayContaining(["marginRules.maxDiscountRate", "marginRules.minMarginCents", "schedule"]));
    expect(conv.mapping.unknownFields.map((u) => u.sourceLabel)).toContain("Couleur du thème");
    expect(JSON.stringify(conv)).not.toContain("hunter2");

    const before = (await client.getSession())!.org.settings;
    const discount = conv.mapping.fields.find((f) => f.target === "marginRules.maxDiscountRate")!;
    const r = await client.applyMigration({ mappingId: conv.id, mapping: conv.mapping, acceptedFieldIds: [discount.id] });
    expect(r.applied.map((a) => a.target)).toEqual(["marginRules.maxDiscountRate"]);
    // Une correspondance appliquée ne s'applique plus ; une correspondance inventée par le client n'existe pas.
    await expect(client.applyMigration({ mappingId: conv.id, mapping: conv.mapping, acceptedFieldIds: [discount.id] })).rejects.toMatchObject({ status: 409 });
    await expect(client.applyMigration({ mappingId: "inventee", mapping: conv.mapping, acceptedFieldIds: [discount.id] })).rejects.toMatchObject({ status: 404 });
    const after = (await client.getSession())!.org.settings;
    expect(after.margin.maxDiscountRate).toBe(0.2);
    expect(after.margin.minMarginCents).toBe(before.margin.minMarginCents);
    expect(after.automation.negotiation.timing).toEqual(before.automation.negotiation.timing);
  });

  it("captures : le simulateur ne les lit pas et le dit ; fichier RGPD JSON lu sans IA ; entrée vide refusée", async () => {
    const shots = await client.convertMigration({ screenshots: ["data:image/png;base64,QUJD"] });
    expect(shots.mapping.fields).toEqual([]);
    expect(shots.mapping.warnings.join(" ")).toMatch(/ne lit pas réellement les captures/);
    const file = await client.importMigrationFile({ fileName: "export.json", content: JSON.stringify({ reglages: { "remise max": "15 %", "relance apres": "24 h", identifiant: "marie@exemple.fr" } }), declaredSource: "clemz" });
    expect(file).toMatchObject({ via: "file", fileFormat: "json" });
    expect(file.mapping.source).toBe("clemz");
    expect(JSON.stringify(file.mapping)).not.toContain("marie@exemple.fr");
    const followUp = file.mapping.fields.find((f) => f.target === "followUp.delayHours");
    expect(followUp).toBeTruthy();
    const applied = await client.applyMigration({ mappingId: file.id, mapping: file.mapping, acceptedFieldIds: [followUp!.id] });
    expect(applied.rulesUpdated).toEqual(["follow_up_no_reply"]);
    await expect(client.convertMigration({ text: "   " })).rejects.toThrow(/Collez vos réglages/);
  });
});

describe("relance après 24 h (§5.12)", () => {
  it("offre Pro : un brouillon à valider par conversation sans réponse, jamais deux, jamais hors heures actives", async () => {
    const rule = await client.createRule({ name: "Relance", kind: "follow_up_24h", enabled: true, schedule: { startHour: 8, endHour: 21, timezone: "Europe/Paris" }, config: { delayHours: 24 } });
    const first = await client.runRuleNow(rule.id);
    expect(first.created).toBeGreaterThan(0);
    // Comme le serveur : tâche « à valider » qui porte le brouillon (payload.draftMessageId).
    const job = (await client.listJobs({ pageSize: 200 })).items.find((j) => j.ruleId === rule.id)!;
    expect(job).toMatchObject({ status: "awaiting_approval", runsIn: "server", payload: { followUp: true, followUpMode: "draft" } });
    const convId = job.payload.conversationId as string;
    const detail = await client.getConversation(convId);
    const drafts = detail.messages.filter((m) => m.status === "draft" && m.ruleId === rule.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(job.payload.draftMessageId);
    expect(drafts[0]!.source).toBe("automation");
    expect(drafts[0]!.body).not.toMatch(/\d/);
    // conv-005 : une relance de l'ancienne règle a déjà été tentée (échec) depuis la dernière réponse → jamais une deuxième.
    expect((await client.getConversation("conv-005")).messages.some((m) => m.ruleId === rule.id)).toBe(false);
    // conv-001 : le dernier message vient de l'acheteur → rien.
    expect((await client.getConversation("conv-001")).messages.some((m) => m.ruleId === rule.id)).toBe(false);
    // Deuxième passage, même le lendemain : aucune nouvelle relance.
    now = new Date("2026-11-08T13:00:00Z");
    const second = await client.runRuleNow(rule.id);
    expect(second.created).toBe(0);
    expect((await client.getConversation(convId)).messages.filter((m) => m.ruleId === rule.id)).toHaveLength(1);
    // Brouillon supprimé : la tâche est annulée, et la relance n'est jamais refaite.
    await client.deleteDraft(drafts[0]!.id);
    expect((await client.listJobs({ pageSize: 200 })).items.find((j) => j.id === job.id)?.status).toBe("cancelled");
    expect((await client.runRuleNow(rule.id)).created).toBe(0);
  });

  it("gabarit et délai de la règle, gabarit hors règle → texte par défaut ; article vendu → aucune relance", async () => {
    const rule = await client.createRule({ name: "Relance", kind: "follow_up_24h", enabled: true, schedule: { startHour: 8, endHour: 21, timezone: "Europe/Paris" }, config: { delayHours: 24, template: "Bonjour {prenom}, -10 % aujourd'hui !" } });
    await client.runRuleNow(rule.id);
    const job = (await client.listJobs({ pageSize: 200 })).items.find((j) => j.ruleId === rule.id)!;
    expect(String(job.payload.body)).not.toMatch(/\d|%/);
    // Délai de la règle : 300 h → aucune conversation n'y arrive (et au-delà de 7 jours on ne relance plus).
    const late = await client.createRule({ name: "Relance tardive", kind: "follow_up_24h", enabled: true, schedule: { startHour: 8, endHour: 21, timezone: "Europe/Paris" }, config: { delayHours: 150 } });
    expect((await client.runRuleNow(late.id)).created).toBe(0);
  });

  it("hors des heures actives : rien n'est créé ; offre Agence : tâche confiée au Cloud (sans validation), brouillon avec validation", async () => {
    const rule = await client.createRule({ name: "Relance", kind: "follow_up_24h", enabled: true, requiresApproval: false, schedule: { startHour: 8, endHour: 21, timezone: "Europe/Paris" } });
    now = new Date("2026-11-07T23:30:00Z");
    expect((await client.runRuleNow(rule.id)).created).toBe(0);
    now = new Date("2026-11-07T13:00:00Z");
    await client.adminSetPlan((await client.getSession())!.org.id, "agence");
    expect((await client.runRuleNow(rule.id)).created).toBeGreaterThan(0);
    const jobs = await client.listJobs({});
    const cloud = jobs.items.filter((j) => j.ruleId === rule.id);
    expect(cloud.length).toBeGreaterThan(0);
    // Compte Vinted avec Selio Cloud actif : relance confiée au Cloud ; sans Cloud actif : brouillon à valider.
    const cloudAccounts = await client.cloudAccounts();
    const active = new Set(cloudAccounts.filter((a) => a.status === "active" && a.hasSession).map((a) => a.connectionId));
    for (const j of cloud) {
      const conv = (await client.getConversation(j.payload.conversationId as string)).conversation;
      if (conv.connectionId && active.has(conv.connectionId)) expect(j).toMatchObject({ runsIn: "cloud", status: "queued" });
      else expect(j).toMatchObject({ runsIn: "server", status: "awaiting_approval" });
    }
    expect(cloud.some((j) => j.runsIn === "cloud" && j.status === "queued")).toBe(true);
    // Validation avant envoi : même en Agence avec Cloud actif, brouillon à valider (envoyé ensuite par le Cloud).
    const withApproval = await client.createRule({ name: "Relance validée", kind: "follow_up_24h", enabled: true, requiresApproval: true, schedule: { startHour: 8, endHour: 21, timezone: "Europe/Paris" } });
    now = new Date("2026-11-08T13:00:00Z");
    await client.runRuleNow(withApproval.id);
    for (const j of (await client.listJobs({ pageSize: 200 })).items.filter((x) => x.ruleId === withApproval.id)) {
      expect(j.status).toBe("awaiting_approval");
      expect(typeof j.payload.draftMessageId).toBe("string");
    }
  });
});

describe("limites de Vinted (§5.12) : à mesurer tant qu'aucune mesure n'est enregistrée", () => {
  it("valeurs prudentes par défaut, puis mesure datée par Selio", async () => {
    const before = (await client.getSession())!.org.settings.automation.vintedLimits;
    expect(before).toMatchObject({ source: "default_conservative", measuredAt: null });
    const limits = await client.recordVintedLimits({ maxCounterOffersPerConversation: 2, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30 });
    expect(limits).toMatchObject({ source: "measured", maxCounterOffersPerConversation: 2, measuredAt: now.toISOString() });
    await expect(client.recordVintedLimits({ maxCounterOffersPerConversation: 0, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30 })).rejects.toThrow();
  });
});

describe("fonctions « que Bleam n'a pas » (§5.14)", () => {
  it("lots intelligents : prix jamais sous le plancher du lot, acheteur et conversation pour le brouillon", async () => {
    const list = await client.suggestBundles();
    expect(list.length).toBeGreaterThan(0);
    for (const b of list) {
      expect(b.bundlePriceCents).toBeGreaterThanOrEqual(b.floorCents);
      expect(b.items).toHaveLength(b.itemIds.length);
      if (b.customerId) expect(b.customer?.id).toBe(b.customerId);
    }
  });

  it("marge de bout en bout : vendus (réalisée) et stock (projetée), achats Radar repérés", async () => {
    const m = await client.getEndToEndMargins("12m");
    expect(m.sold.count).toBeGreaterThan(0);
    expect(m.inStock.count).toBeGreaterThan(0);
    expect(m.rows.every((r) => r.marginCents === r.revenueCents - r.costCents)).toBe(true);
    expect(m.rows.some((r) => r.status === "realized")).toBe(true);
  });

  it("seuils de déclaration : information factuelle, jamais un conseil fiscal", async () => {
    const t = await client.getDeclarationThresholds();
    expect(t.enabled).toBe(true);
    expect(t.thresholds).toMatchObject({ salesCount: 30, revenueCents: 200_000 });
    expect(t.text).toContain("renseignez-vous auprès de l'administration");
    expect(t.disclaimer).toBe(THRESHOLD_DISCLAIMER);
    expect(t.text).not.toMatch(/vous devez|il faut|déclarez/i);
  });
});
