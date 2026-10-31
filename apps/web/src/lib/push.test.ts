import { describe, expect, it, vi } from "vitest";
import { deviceLabel, disablePush, enablePush, pushSupport, showLocalNotification, subscriptionToInput, unsubscribeOnLogout, urlBase64ToUint8Array, type PushEnv } from "./push";

/** PushManager simulé : un abonnement par appareil, `subscribe` crée l'abonnement, `unsubscribe` le retire. */
function fakeDevice(opts: { permission?: NotificationPermission; grant?: NotificationPermission; secure?: boolean; pushManager?: boolean } = {}) {
  let current: (PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> }) | null = null;
  const makeSub = () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/appareil-123";
    const sub = {
      endpoint,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }),
      unsubscribe: vi.fn(async () => {
        current = null;
        return true;
      }),
    };
    return sub as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
  };
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (_o: PushSubscriptionOptionsInit) => (current = makeSub())),
  };
  const registration = { pushManager, showNotification: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
  const Notification = { permission: opts.permission ?? "default", requestPermission: vi.fn(async () => opts.grant ?? "granted") };
  const env: PushEnv = {
    isSecureContext: opts.secure ?? true,
    serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration } as unknown as PushEnv["serviceWorker"],
    hasPushManager: opts.pushManager ?? true,
    Notification: Notification as unknown as PushEnv["Notification"],
    userAgent: "Mozilla/5.0 (iPhone) Selio test",
  };
  return { env, pushManager, registration, Notification, current: () => current };
}

// Valeur factice de la bonne forme (65 octets en base64url) : aucune clé VAPID réelle dans le dépôt.
const PUBLIC_KEY = `B${"A".repeat(86)}`;

describe("notifications de la PWA (PushManager simulé)", () => {
  it("décode la clé publique VAPID (base64url) en octets", () => {
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
    expect(urlBase64ToUint8Array(PUBLIC_KEY)).toHaveLength(65);
  });

  it("navigateur sans PushManager ou page non sécurisée : désactivé, avec l'explication", () => {
    expect(pushSupport(fakeDevice({ secure: false }).env)).toMatchObject({ supported: false, reason: expect.stringMatching(/https/) });
    expect(pushSupport(fakeDevice({ pushManager: false }).env)).toMatchObject({ supported: false, reason: expect.stringMatching(/écran d'accueil/) });
    expect(pushSupport(fakeDevice().env)).toEqual({ supported: true, reason: null });
  });

  it("abonne l'appareil avec la clé publique du serveur et envoie l'abonnement à l'API (adresse et clés seulement)", async () => {
    const d = fakeDevice();
    const client = { subscribePush: vi.fn(async () => ({}) as never) };
    expect(await enablePush(client, PUBLIC_KEY, d.env)).toEqual({ ok: true });
    expect(d.Notification.requestPermission).toHaveBeenCalledTimes(1);
    const options = d.pushManager.subscribe.mock.calls[0]![0];
    expect(options.userVisibleOnly).toBe(true);
    expect([...(options.applicationServerKey as Uint8Array)]).toEqual([...urlBase64ToUint8Array(PUBLIC_KEY)]);
    expect(client.subscribePush).toHaveBeenCalledWith({ endpoint: "https://fcm.googleapis.com/fcm/send/appareil-123", keys: { p256dh: expect.any(String), auth: "tBHItJI5svbpez7KI4CCXg" }, userAgent: "Mozilla/5.0 (iPhone) Selio test" });
  });

  it("permission refusée : aucun abonnement ; sans clé serveur : rien n'est demandé", async () => {
    const denied = fakeDevice({ grant: "denied" });
    const client = { subscribePush: vi.fn() };
    expect(await enablePush(client, PUBLIC_KEY, denied.env)).toMatchObject({ ok: false, reason: "denied" });
    expect(denied.pushManager.subscribe).not.toHaveBeenCalled();
    const noKey = fakeDevice();
    expect(await enablePush(client, null, noKey.env)).toMatchObject({ ok: false, reason: "no_key" });
    expect(noKey.Notification.requestPermission).not.toHaveBeenCalled();
    expect(client.subscribePush).not.toHaveBeenCalled();
  });

  it("refus de l'API : l'abonnement local est défait", async () => {
    const d = fakeDevice({ permission: "granted" });
    const client = { subscribePush: vi.fn(async () => { throw new Error("refusé"); }) };
    await expect(enablePush(client, PUBLIC_KEY, d.env)).rejects.toThrow("refusé");
    expect(d.current()).toBeNull();
  });

  it("désactive : désabonnement local puis côté serveur", async () => {
    const d = fakeDevice({ permission: "granted" });
    await enablePush({ subscribePush: vi.fn(async () => ({}) as never) }, PUBLIC_KEY, d.env);
    const sub = d.current()!;
    const client = { unsubscribePush: vi.fn(async () => ({ removed: true })) };
    expect(await disablePush(client, d.env)).toBe(true);
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(client.unsubscribePush).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/appareil-123");
    expect(await disablePush(client, d.env)).toBe(false);
  });

  it("abonnement incomplet refusé ; notification locale seulement avec la permission", async () => {
    expect(() => subscriptionToInput({ toJSON: () => ({ endpoint: "https://x" }) } as unknown as PushSubscription, "")).toThrow(/incomplet/);
    const payload = { title: "Test", body: "Corps", url: "/app/radar" };
    const granted = fakeDevice({ permission: "granted" });
    expect(await showLocalNotification(payload, granted.env)).toBe(true);
    expect(granted.registration.showNotification).toHaveBeenCalledWith("Test", expect.objectContaining({ body: "Corps", icon: "/icon-192.png", data: { url: "/app/radar" } }));
    expect(await showLocalNotification(payload, fakeDevice({ permission: "denied" }).env)).toBe(false);
  });

  it("déconnexion : l'abonnement de cet appareil est retiré d'abord, sans jamais bloquer la déconnexion", async () => {
    const d = fakeDevice({ permission: "granted" });
    const client = { subscribePush: vi.fn(async () => ({}) as never), unsubscribePush: vi.fn(async () => ({ removed: true })) };
    await enablePush(client, PUBLIC_KEY, d.env);
    expect(await unsubscribeOnLogout(client, d.env)).toBe(true);
    expect(client.unsubscribePush).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/appareil-123");
    expect(d.current()).toBeNull();
    // Erreur de l'API ou serveur muet : la déconnexion continue (faux, jamais d'exception).
    await enablePush(client, PUBLIC_KEY, d.env);
    const failing = { unsubscribePush: vi.fn(async () => { throw new Error("réseau"); }) };
    expect(await unsubscribeOnLogout(failing, d.env)).toBe(false);
    await enablePush(client, PUBLIC_KEY, d.env);
    const silent = { unsubscribePush: vi.fn(() => new Promise<{ removed: boolean }>(() => {})) };
    expect(await unsubscribeOnLogout(silent, d.env, 20)).toBe(false);
  });

  it("nom lisible d'un appareil abonné (pour le retirer de la liste)", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari sur iPhone ou iPad");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe("Chrome sur Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0")).toBe("Edge sur Windows");
    expect(deviceLabel(null)).toBe("Appareil inconnu");
  });
});
