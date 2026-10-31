import { describe, expect, it, vi } from "vitest";
import SOURCE from "../../public/push-handler.js?raw";
import VITE_CONFIG from "../../vite.config.ts?raw";

/**
 * Gestionnaire push du service worker (public/push-handler.js), exécuté dans un `self` simulé : il est
 * importé tel quel par le service worker généré (workbox `importScripts`, vite.config.ts).
 */
const ORIGIN = "https://app.selio.example";

type Handler = (event: Record<string, unknown>) => void;

function worker(windows: { url: string }[] = []) {
  const handlers: Record<string, Handler> = {};
  const clients = windows.map((w) => {
    const c = { url: w.url, focus: vi.fn(async () => c), navigate: vi.fn(async (u: string) => ({ ...c, url: u })) };
    return c;
  });
  const self = {
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    registration: { showNotification: vi.fn(async () => undefined) },
    location: { origin: ORIGIN },
    clients: { matchAll: vi.fn(async () => clients), openWindow: vi.fn(async () => null) },
  };
  new Function("self", SOURCE)(self);
  return { self, handlers, clients };
}

async function push(w: ReturnType<typeof worker>, data: { json: () => unknown; text: () => string } | null) {
  const waits: Promise<unknown>[] = [];
  w.handlers.push!({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

async function click(w: ReturnType<typeof worker>, url: unknown) {
  const waits: Promise<unknown>[] = [];
  const notification = { data: { url }, close: vi.fn() };
  w.handlers.notificationclick!({ notification, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return notification;
}

const json = (v: unknown) => ({ json: () => v, text: () => JSON.stringify(v) });

describe("service worker : gestionnaire des notifications push", () => {
  it("est importé par le service worker généré (workbox importScripts)", () => {
    expect(VITE_CONFIG).toMatch(/importScripts:\s*\["push-handler\.js"\]/);
    expect(SOURCE).not.toMatch(/\bimport\s|\bexport\s/);
  });

  it("affiche la notification : titre, texte, icône Selio, adresse dans data.url", async () => {
    const w = worker();
    await push(w, json({ title: "Affaire Radar : Pull Tommy", body: "6,00 € · note 88", url: "/app/radar/affaires/abc-123" }));
    expect(w.self.registration.showNotification).toHaveBeenCalledWith("Affaire Radar : Pull Tommy", expect.objectContaining({ body: "6,00 € · note 88", icon: "/icon-192.png", lang: "fr", data: { url: "/app/radar/affaires/abc-123" } }));
  });

  it("n'ouvre jamais une adresse externe ; contenu illisible : notification Selio par défaut", async () => {
    const w = worker();
    await push(w, json({ title: "x", body: "y", url: "https://evil.example/piege" }));
    await push(w, json({ title: "x", body: "y", url: "//evil.example" }));
    await push(w, { json: () => { throw new Error("pas du JSON"); }, text: () => "Nouvelle affaire" });
    await push(w, null);
    const calls = w.self.registration.showNotification.mock.calls as unknown as [string, { body: string; data: { url: string } }][];
    expect(calls.map(([, o]) => o.data.url)).toEqual(["/app/radar", "/app/radar", "/app/radar", "/app/radar"]);
    expect(calls[2]![0]).toBe("Selio");
    expect(calls[2]![1].body).toBe("Nouvelle affaire");
  });

  it("clic : focalise l'onglet déjà sur l'affaire, sinon amène un onglet Selio ouvert sur data.url", async () => {
    const same = worker([{ url: `${ORIGIN}/app/radar/affaires/abc` }]);
    const n = await click(same, "/app/radar/affaires/abc");
    expect(n.close).toHaveBeenCalled();
    expect(same.clients[0]!.focus).toHaveBeenCalled();
    expect(same.clients[0]!.navigate).not.toHaveBeenCalled();

    const other = worker([{ url: "https://ailleurs.example/" }, { url: `${ORIGIN}/app` }]);
    await click(other, "/app/radar/affaires/abc");
    expect(other.clients[0]!.focus).not.toHaveBeenCalled();
    expect(other.clients[1]!.focus).toHaveBeenCalled();
    expect(other.clients[1]!.navigate).toHaveBeenCalledWith(`${ORIGIN}/app/radar/affaires/abc`);
    expect(other.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("clic sans onglet Selio ouvert : ouvre l'application sur data.url (chemin interne seulement)", async () => {
    const w = worker();
    await click(w, "/app/radar/achats/p-1");
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/app/radar/achats/p-1`);
    await click(w, "javascript:alert(1)");
    expect(w.self.clients.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/app/radar`);
  });
});
