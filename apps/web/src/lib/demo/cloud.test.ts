import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { CLOUD_CONSENT_TEXT, CLOUD_CONSENT_VERSION, CLOUD_LOGIN_TTL_MINUTES } from "@selio/contracts";
import { DataError } from "../data/types";
import { DemoClient } from "./client";
import { sha256Hex } from "./cloud";

const NOW = new Date("2026-10-29T12:00:00Z");
let client: DemoClient;
let storage: MemoryDemoStorage;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof DataError ? e.code : String(e);
  }
  return "ok";
}

async function asAgence() {
  const s = await client.getSession();
  await client.adminSetPlan(s!.org.id, "agence");
}

beforeEach(async () => {
  storage = new MemoryDemoStorage();
  client = new DemoClient(storage, () => NOW);
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
});

describe("Selio Cloud dans la démonstration", () => {
  it("démarre avec un compte actif, un compte en pause après un CAPTCHA, 30 actions sur 10 jours et aucun accord", async () => {
    const accounts = await client.cloudAccounts();
    expect(accounts.map((a) => [a.connectionLabel, a.status, a.pausedReason])).toEqual([
      ["Boutique principale", "active", null],
      ["Boutique vintage", "paused", "captcha"],
    ]);
    expect(accounts.every((a) => a.hasSession && a.settings.levels.join() === "light")).toBe(true);
    const page = await client.cloudJournal({ page: 1, pageSize: 200 });
    expect(page.total).toBe(30);
    const days = new Set(page.items.map((a) => a.createdAt.slice(0, 10)));
    expect(days.size).toBe(10);
    expect(page.items.every((a) => a.level === "light" && (a.kind === "reply" || a.kind === "follow_up"))).toBe(true);
    // Jamais de texte de message ni de session dans le journal : seulement la longueur et la référence.
    expect(JSON.stringify(page.items)).not.toMatch(/"(text|body|cookies|password)"/);
    const captcha = page.items.find((a) => a.detail.code === "captcha")!;
    expect(captcha).toMatchObject({ status: "paused", accountId: accounts[1]!.id, detail: { sideEffects: "none" } });
    expect(accounts[1]!.pausedAt).toBe(captcha.finishedAt);
    const consent = await client.cloudConsent();
    expect(consent).toMatchObject({ version: CLOUD_CONSENT_VERSION, text: CLOUD_CONSENT_TEXT, accepted: null, current: false });
    // L'état est persisté avec la démonstration : un nouveau client relit la même chose.
    const again = new DemoClient(storage, () => NOW);
    expect((await again.cloudAccounts()).map((a) => a.id)).toEqual(accounts.map((a) => a.id));
  });

  it("disponibilité selon l'offre : Pro en option (prix à décider, rien d'activable), Agence compris, Starter indisponible", async () => {
    const pro = await client.cloudAvailability();
    expect(pro).toMatchObject({ plan: "pro", included: false, optional: true, available: false, maxAccounts: 0, heavyActionsEnabled: false });
    expect(pro.reason).toMatch(/prix à décider/);
    expect(pro.capacityNote).toMatch(/hypothèse à mesurer/);
    await asAgence();
    expect(await client.cloudAvailability()).toMatchObject({ plan: "agence", included: true, available: true, maxAccounts: 10, actionsPerDay: 2000 });
    const s = await client.getSession();
    await client.adminSetPlan(s!.org.id, "starter");
    const starter = await client.cloudAvailability();
    expect(starter).toMatchObject({ included: false, optional: false, available: false });
    // Comme le serveur : sans Cloud dans l'offre, les comptes sont arrêtés et les sessions effacées.
    expect((await client.cloudAccounts()).every((a) => a.status === "stopped" && !a.hasSession)).toBe(true);
  });

  it("l'accord bloque l'activation, puis s'enregistre avec la version, la date et l'empreinte du texte", async () => {
    await asAgence();
    const connections = await client.listConnections();
    const purchase = connections.find((c) => c.usage === "purchase")!;
    expect(await code(client.enableCloudAccount(purchase.id))).toBe("consent_required");
    expect(await code(client.startCloudLogin((await client.cloudAccounts())[0]!.id))).toBe("consent_required");
    expect(await code(client.acceptCloudConsent({ version: "ancienne", accepted: true }))).toBe("conflict");
    const view = await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
    expect(view.current).toBe(true);
    expect(view.accepted).toMatchObject({ version: CLOUD_CONSENT_VERSION, acceptedAt: NOW.toISOString(), textHash: await sha256Hex(CLOUD_CONSENT_TEXT) });
    const enabled = await client.enableCloudAccount(purchase.id);
    expect(enabled).toMatchObject({ connectionId: purchase.id, status: "needs_login", hasSession: false });
    // Un compte Perso n'est jamais relié ; un compte déjà relié est rendu tel quel.
    const personal = connections.find((c) => c.usage === "personal")!;
    expect(await code(client.enableCloudAccount(personal.id))).toBe("validation");
    expect((await client.enableCloudAccount(purchase.id)).id).toBe(enabled.id);
  });

  it("sur Pro, rien n'est activable même avec l'accord", async () => {
    await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
    const purchase = (await client.listConnections()).find((c) => c.usage === "purchase")!;
    expect(await code(client.enableCloudAccount(purchase.id))).toBe("cloud_unavailable");
  });

  it("pause, reprise avec acquittement après un CAPTCHA, arrêt et suppression de session", async () => {
    await asAgence();
    await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
    const [active, captcha] = await client.cloudAccounts();
    expect(await code(client.resumeCloudAccount(captcha!.id))).toBe("acknowledge_required");
    expect(await client.resumeCloudAccount(captcha!.id, { acknowledge: true })).toMatchObject({ status: "active", pausedReason: null });
    expect(await client.pauseCloudAccount(active!.id)).toMatchObject({ status: "paused", pausedReason: "client" });
    // Une pause demandée par le client reprend sans acquittement.
    expect(await client.resumeCloudAccount(active!.id)).toMatchObject({ status: "active" });
    expect(await client.deleteCloudSession(active!.id)).toMatchObject({ status: "needs_login", hasSession: false, sessionSavedAt: null });
    expect(await client.stopCloudAccount(captcha!.id)).toMatchObject({ status: "stopped", hasSession: false });
    expect(await code(client.pauseCloudAccount(captcha!.id))).toBe("conflict");
    // Les actions lourdes restent fermées (à décider : adresse partagée).
    expect(await code(client.updateCloudSettings(active!.id, { levels: ["light", "heavy"] }))).toBe("heavy_disabled");
    const audit = (await client.listAuditLogs(50)).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["cloud.account.resumed", "cloud.account.paused", "cloud.session.deleted", "cloud.account.stopped", "cloud.consent.accepted"]));
  });

  it("connexion simulée : aucune adresse de WebSocket, la session est enregistrée sans rien saisir", async () => {
    await asAgence();
    await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
    const purchase = (await client.listConnections()).find((c) => c.usage === "purchase")!;
    const account = await client.enableCloudAccount(purchase.id);
    const start = await client.startCloudLogin(account.id);
    expect(start).toMatchObject({ simulated: true, socketUrl: null });
    // Même validité que le serveur (CLOUD_LOGIN_TIMEOUT_MS, 5 min).
    expect(new Date(start.expiresAt).getTime() - NOW.getTime()).toBe(CLOUD_LOGIN_TTL_MINUTES * 60_000);
    const done = await client.completeSimulatedCloudLogin(start.loginSessionId);
    expect(done).toMatchObject({ status: "active", hasSession: true, sessionSavedAt: NOW.toISOString() });
    expect(await code(client.completeSimulatedCloudLogin(start.loginSessionId))).toBe("conflict");
    // Une fenêtre annulée ne peut plus aboutir.
    const second = await client.startCloudLogin(account.id);
    await client.cancelCloudLogin(second.loginSessionId);
    expect(await code(client.completeSimulatedCloudLogin(second.loginSessionId))).toBe("conflict");
  });

  it("journal paginé et filtré, export CSV sans texte de message", async () => {
    const p1 = await client.cloudJournal({ page: 1, pageSize: 10 });
    expect(p1).toMatchObject({ total: 30, page: 1, pageCount: 3 });
    expect(p1.items).toHaveLength(10);
    const p3 = await client.cloudJournal({ page: 3, pageSize: 10 });
    expect(p3.items).toHaveLength(10);
    expect(p1.items[0]!.createdAt >= p3.items[9]!.createdAt).toBe(true);
    expect((await client.cloudJournal({ status: "failed" })).total).toBe(2);
    expect((await client.cloudJournal({ kind: "follow_up" })).items.every((a) => a.kind === "follow_up")).toBe(true);
    const second = (await client.cloudAccounts())[1]!;
    expect((await client.cloudJournal({ accountId: second.id })).items.every((a) => a.accountId === second.id)).toBe(true);
    const csv = await client.exportCloudJournalCsv({ status: "failed" });
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain("Date;Compte;Action;Niveau;Statut;Résultat");
    expect(lines).toHaveLength(3);
    expect(csv).toContain("Échouée");
  });

  it("déconnecter ou supprimer le compte Vinted arrête le Cloud et efface la session", async () => {
    const [active, captcha] = await client.cloudAccounts();
    await client.disconnectConnection(active!.connectionId);
    expect((await client.cloudAccounts()).find((a) => a.id === active!.id)).toMatchObject({ status: "stopped", hasSession: false });
    await client.deleteConnection(captcha!.connectionId);
    expect((await client.cloudAccounts()).map((a) => a.id)).toEqual([active!.id]);
    expect((await client.cloudJournal({ accountId: captcha!.id })).total).toBe(0);
  });
});
