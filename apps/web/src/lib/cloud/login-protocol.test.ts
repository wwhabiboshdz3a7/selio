import { afterEach, describe, expect, it, vi } from "vitest";
import { quotasForPlan } from "@selio/contracts";
import { cloudAvailabilityFor, cloudOfferKind, DEFAULT_CLOUD_SETTINGS } from "./availability";
import { LOGIN_CLOSED_MESSAGES, createThrottle, formatRemaining, keyMessage, loginSocketUrl, modifiersOf, mouseMessage, parseServerMessage, textMessages, toRemotePoint, wheelMessage } from "./login-protocol";

afterEach(() => {
  vi.useRealTimers();
});

describe("protocole de la fenêtre de connexion", () => {
  it("lit seulement les messages connus du serveur, bornés", () => {
    expect(parseServerMessage(JSON.stringify({ type: "ready", width: 1280, height: 800, expiresAt: "2026-10-29T12:15:00Z" }))).toEqual({ type: "ready", width: 1280, height: 800, expiresAt: "2026-10-29T12:15:00Z" });
    expect(parseServerMessage(JSON.stringify({ type: "frame", data: "AAAA/9j=", width: 640, height: 400 }))).toEqual({ type: "frame", data: "AAAA/9j=", width: 640, height: 400 });
    // Format de l'API (apps/api/src/routes/cloud.ts) : « ready » sans taille, « done », « closed » avec sa raison.
    expect(parseServerMessage(JSON.stringify({ type: "ready", loginSessionId: "x", expiresAt: "2026-10-29T12:15:00Z" }))).toEqual({ type: "ready", expiresAt: "2026-10-29T12:15:00Z" });
    expect(parseServerMessage(JSON.stringify({ type: "status", status: "open" }))).toEqual({ type: "status", status: "open" });
    expect(parseServerMessage(JSON.stringify({ type: "status", status: "logged_in" }))).toEqual({ type: "status", status: "logged_in" });
    expect(parseServerMessage(JSON.stringify({ type: "done" }))).toEqual({ type: "done" });
    expect(parseServerMessage(JSON.stringify({ type: "closed", reason: "no_session" }))).toEqual({ type: "closed", reason: "no_session" });
    // Signal de Vinted pendant la connexion, ou page hors de Vinted : fenêtre fermée, message dédié.
    expect(parseServerMessage(JSON.stringify({ type: "closed", reason: "vinted_signal" }))).toEqual({ type: "closed", reason: "vinted_signal" });
    expect(parseServerMessage(JSON.stringify({ type: "closed", reason: "navigation_refused" }))).toEqual({ type: "closed", reason: "navigation_refused" });
    expect(LOGIN_CLOSED_MESSAGES.vinted_signal).toMatch(/ne contourne jamais/);
    expect(parseServerMessage(JSON.stringify({ type: "closed", status: "finished" }))).toEqual({ type: "done" });
    expect(parseServerMessage(JSON.stringify({ type: "error", message: "x".repeat(1000) }))!).toMatchObject({ type: "error" });
    expect((parseServerMessage(JSON.stringify({ type: "error", message: "x".repeat(1000) })) as { message: string }).message).toHaveLength(300);
    // Inconnu, illisible ou hors bornes : ignoré.
    for (const raw of ["pas du json", "[]", JSON.stringify({ type: "eval", code: "x" }), JSON.stringify({ type: "frame", data: "<script>" }), JSON.stringify({ type: "status", status: "other" }), JSON.stringify({ type: "closed", status: "boom" })]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });

  it("ramène un point du canvas affiché à l'échelle vers la page distante", () => {
    const rect = { left: 10, top: 20, width: 640, height: 400 };
    expect(toRemotePoint(10 + 320, 20 + 200, rect, { width: 1280, height: 800 })).toEqual({ x: 640, y: 400 });
    expect(toRemotePoint(-50, 9999, rect, { width: 1280, height: 800 })).toEqual({ x: 0, y: 799 });
    expect(toRemotePoint(5, 5, { left: 0, top: 0, width: 0, height: 0 }, { width: 1280, height: 800 })).toEqual({ x: 0, y: 0 });
  });

  it("souris : boutons, nombre de clics, molette bornée et modificateurs au format CDP", () => {
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
    expect(mouseMessage("down", { x: 3, y: 4 }, { button: 2, detail: 2, shiftKey: true })).toEqual({ type: "mouse", action: "down", x: 3, y: 4, button: "right", clickCount: 2, modifiers: 8 });
    expect(mouseMessage("move", { x: 3, y: 4 }, { button: 0 })).toEqual({ type: "mouse", action: "move", x: 3, y: 4, button: "none", clickCount: 0, modifiers: 0 });
    expect(wheelMessage({ x: 1, y: 2 }, { deltaX: 0, deltaY: 99999 })).toMatchObject({ action: "wheel", deltaY: 4096 });
    expect(wheelMessage({ x: 1, y: 2 }, { deltaX: 0, deltaY: 3, deltaMode: 1 })).toMatchObject({ deltaY: 48 });
  });

  it("clavier : caractère imprimable avec la touche, Entrée valide, collage et composition laissés au navigateur", () => {
    expect(keyMessage("down", { key: "a", code: "KeyA", keyCode: 65 })).toEqual({ type: "key", action: "down", key: "a", code: "KeyA", keyCode: 65, text: "a", modifiers: 0 });
    expect(keyMessage("up", { key: "a", code: "KeyA", keyCode: 65 })).toEqual({ type: "key", action: "up", key: "a", code: "KeyA", keyCode: 65, modifiers: 0 });
    expect(keyMessage("down", { key: "Enter", code: "Enter", keyCode: 13 })).toMatchObject({ text: "\r" });
    expect(keyMessage("down", { key: "Tab", code: "Tab", keyCode: 9 })).not.toHaveProperty("text");
    expect(keyMessage("down", { key: "a", ctrlKey: true })).toMatchObject({ modifiers: 2 });
    expect(keyMessage("down", { key: "a", ctrlKey: true })).not.toHaveProperty("text");
    expect(keyMessage("down", { key: "v", ctrlKey: true })).toBeNull();
    expect(keyMessage("down", { key: "V", metaKey: true, shiftKey: true })).toBeNull();
    expect(keyMessage("down", { key: "Unidentified", keyCode: 229 })).toBeNull();
    expect(keyMessage("down", { key: "é", isComposing: true })).toBeNull();
  });

  it("texte collé : morceaux de 256 caractères, longueur bornée", () => {
    expect(textMessages("")).toEqual([]);
    const chunks = textMessages("x".repeat(600));
    expect(chunks.map((c) => c.text.length)).toEqual([256, 256, 88]);
    expect(textMessages("y".repeat(10_000)).reduce((n, c) => n + c.text.length, 0)).toBe(2048);
  });

  it("déplacements limités en cadence, le dernier point toujours envoyé", () => {
    vi.useFakeTimers();
    let t = 0;
    const sent: number[] = [];
    const th = createThrottle<number>((v) => sent.push(v), 50, () => t);
    th.push(1);
    th.push(2);
    th.push(3);
    expect(sent).toEqual([1]);
    t = 50;
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([1, 3]);
    th.push(4);
    th.cancel();
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([1, 3]);
  });

  it("adresse du WebSocket : wss en https, ticket en paramètre, repli local", () => {
    expect(loginSocketUrl("https://api.selio.example", "login-1", "t".repeat(40), "https://app.selio.example/cloud/comptes")).toBe(`wss://api.selio.example/api/cloud/login/login-1/ws?ticket=${"t".repeat(40)}`);
    expect(loginSocketUrl("", "login-1", "abc", "http://127.0.0.1:5173/cloud")).toBe("ws://127.0.0.1:5173/api/cloud/login/login-1/ws?ticket=abc");
    expect(loginSocketUrl("", "a/b", "abc", "about:blank")).toBe("ws://localhost/api/cloud/login/a%2Fb/ws?ticket=abc");
    expect(formatRemaining(125_000)).toBe("2:05");
    expect(formatRemaining(-1)).toBe("0:00");
  });
});

describe("Selio Cloud selon l'offre", () => {
  it("Agence : compris ; Pro : en option, prix à décider ; accès de base et Starter : à partir de Pro", () => {
    const agence = cloudAvailabilityFor("agence", quotasForPlan("agence"));
    expect(agence).toMatchObject({ included: true, available: true, maxAccounts: 10, actionsPerDay: 2000, maxBrowsers: 5, heavyActionsEnabled: false });
    expect(cloudOfferKind(agence)).toBe("included");
    const pro = cloudAvailabilityFor("pro", quotasForPlan("pro"));
    expect(pro).toMatchObject({ included: false, optional: true, available: false, maxAccounts: 0 });
    expect(cloudOfferKind(pro)).toBe("option_pending");
    const proOpen = cloudAvailabilityFor("pro", quotasForPlan("pro"), { ...DEFAULT_CLOUD_SETTINGS, proOption: true });
    expect(proOpen).toMatchObject({ available: true, maxAccounts: 3 });
    expect(proOpen.reason).toMatch(/rien n'est facturé/);
    expect(cloudOfferKind(proOpen)).toBe("option_open");
    for (const plan of ["free", "starter", "inconnu"]) {
      const av = cloudAvailabilityFor(plan, quotasForPlan(plan === "inconnu" ? "free" : (plan as "free" | "starter")));
      expect(cloudOfferKind(av)).toBe("unavailable");
      expect(av.available).toBe(false);
    }
    expect(agence.capacityNote).toMatch(/hypothèse à mesurer/);
    expect(agence.capacityNote).not.toMatch(/mesuré :/);
  });
});
