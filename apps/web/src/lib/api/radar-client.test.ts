import { afterEach, describe, expect, it, vi } from "vitest";
import { RADAR_AUTO_SHARED_ADDRESS_NOTICE } from "@selio/contracts";
import { ApiClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(respond: (url: string, init: RequestInit) => Response = () => new Response("{}", { status: 200 })) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return respond(url, init);
  }));
  return calls;
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const BASE = "https://api.selio.example";

describe("ApiClient : Radar et notifications", () => {
  it("appelle les routes de l'API (mesures, affaire, réglages, Radar Auto, 3-D Secure, notifications)", async () => {
    const calls = stubFetch(() => json({}));
    const api = new ApiClient(BASE);
    await api.radarMetrics(30);
    await api.getOpportunity("opp-1");
    await api.updateRadarSettings({ radar: { alertMinScore: 80 } });
    await api.updateSearch("s-1", { source: "cloud", priority: true, connectionId: "conn-1" });
    await api.autoBuyStatus();
    await api.resumePurchase("p-1");
    await api.pushConfig();
    await api.listPushSubscriptions();
    await api.subscribePush({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "BCdemoCleP256dh0123456789", auth: "authdemo1234" } });
    await api.unsubscribePush("https://fcm.googleapis.com/fcm/send/x");
    await api.testPush();
    expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual([
      "GET /api/radar/metrics?days=30",
      "GET /api/radar/opportunities/opp-1",
      "PATCH /api/radar/settings",
      "PATCH /api/radar/searches/s-1",
      "GET /api/radar/auto/status",
      "POST /api/purchases/p-1/resume",
      "GET /api/push/config",
      "GET /api/push/subscriptions",
      "POST /api/push/subscriptions",
      "DELETE /api/push/subscriptions",
      "POST /api/push/test",
    ]);
    expect(calls[3]!.body).toEqual({ source: "cloud", priority: true, connectionId: "conn-1" });
    expect(calls[9]!.body).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/x" });
  });

  it("Radar Auto : réponse du serveur lue sans confiance ; verrou absent = fermé", async () => {
    stubFetch(() => json({
      active: false,
      locks: [
        { key: "server", label: "Verrou du serveur (RADAR_AUTO_ENABLED)", ok: true, detail: "Ouvert" },
        { key: "shared_address", label: "Adresse partagée", ok: false, detail: RADAR_AUTO_SHARED_ADDRESS_NOTICE },
        { key: "organization", label: "Réglage", ok: false, detail: "Désactivé" },
      ],
      reasons: ["Organisation hors des comptes de l'équipe"],
      notice: RADAR_AUTO_SHARED_ADDRESS_NOTICE,
      realPurchase: false,
      settings: { enabled: false, threshold: 90, dailyCapCents: 5000, maxItemCents: 2000, cancelWindowMinutes: 15, connectionId: null },
      account: { id: "conn-1", label: "Compte achats" },
    }));
    const status = await new ApiClient(BASE).autoBuyStatus();
    // Serveur ouvert mais organisation hors des comptes de l'équipe : pas activable.
    expect(status).toMatchObject({ active: false, serverEnabled: false, orgEnabled: false, realPurchase: false, account: { id: "conn-1" }, settings: { threshold: 90 } });
    expect(status.locks.map((l) => l.key)).toEqual(["server", "shared_address", "organization"]);

    stubFetch(() => json({ active: true }));
    const empty = await new ApiClient(BASE).autoBuyStatus();
    expect(empty.active).toBe(false);
    expect(empty.serverEnabled).toBe(false);
    expect(empty.settings.enabled).toBe(false);
    expect(empty.notice).toBe(RADAR_AUTO_SHARED_ADDRESS_NOTICE);
  });

  it("3-D Secure : 202 { queued } = relecture en file dans le worker ; sinon la demande à jour", async () => {
    const purchase = { id: "p-1", status: "awaiting_3ds" };
    stubFetch(() => json({ queued: true, purchase }, 202));
    expect(await new ApiClient(BASE).resumePurchase("p-1")).toEqual({ queued: true, purchase });
    stubFetch(() => json({ ...purchase, status: "executed" }));
    expect(await new ApiClient(BASE).resumePurchase("p-1")).toEqual({ queued: false, purchase: { ...purchase, status: "executed" } });
  });

  it("notifications : sans clé publique, désactivées avec une explication ; affaire complétée", async () => {
    stubFetch(() => json({ enabled: false, publicKey: null }));
    expect(await new ApiClient(BASE).pushConfig()).toEqual({ enabled: false, publicKey: null, reason: expect.stringMatching(/VAPID/) });
    stubFetch(() => json({ enabled: true, publicKey: "BEl62iUY" }));
    expect(await new ApiClient(BASE).pushConfig()).toEqual({ enabled: true, publicKey: "BEl62iUY", reason: null });
    stubFetch(() => json({ id: "opp-1", title: "Pull" }));
    expect(await new ApiClient(BASE).getOpportunity("opp-1")).toMatchObject({ id: "opp-1", search: null, purchase: null, itemUrl: null });
  });
});
