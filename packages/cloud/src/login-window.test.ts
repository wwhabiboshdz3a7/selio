import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginInputError, LoginWindowClosedError } from "./errors";
import { LoginWindow, toCdpInput, type CdpLike, type LoginContextLike, type LoginPageLike } from "./login-window";
import type { CloudLogger, LoginWindowStatus, ScreencastFrame } from "./types";

class FakeCdp implements CdpLike {
  sent: { method: string; params?: Record<string, unknown> }[] = [];
  listeners = new Map<string, Set<(p: unknown) => void>>();
  detached = false;
  failNext = false;
  async send(method: string, params?: Record<string, unknown>) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error(`Protocol error: ${JSON.stringify(params)}`);
    }
    this.sent.push({ method, params });
    return {};
  }
  on(event: string, listener: (p: unknown) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: (p: unknown) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  async detach() {
    this.detached = true;
  }
  emit(event: string, payload: unknown) {
    for (const l of this.listeners.get(event) ?? []) l(payload);
  }
  methods() {
    return this.sent.map((s) => s.method);
  }
}

class FakePage implements LoginPageLike {
  currentUrl = "https://www.vinted.fr/member/signup/select_type";
  visible = new Set<string>();
  html = "<html><head><title>Vinted</title></head><body><form><input type=\"email\"><input type=\"password\"></form></body></html>";
  url() {
    return this.currentUrl;
  }
  async isVisible(selector: string) {
    return this.visible.has(selector);
  }
  async content() {
    return this.html;
  }
}

class FakeContext implements LoginContextLike {
  closed = false;
  cookieJar: { name: string; value: string; domain: string }[] = [];
  raw: unknown = { cookies: [], origins: [] };
  async cookies() {
    return this.cookieJar;
  }
  async storageState() {
    return this.raw;
  }
  async close() {
    this.closed = true;
  }
}

const frame = (sessionId: number) => ({ data: "AAAA", sessionId, metadata: { deviceWidth: 1280, deviceHeight: 800 } });

describe("LoginWindow", () => {
  let cdp: FakeCdp;
  let page: FakePage;
  let context: FakeContext;
  let logs: { message: string; data?: Record<string, unknown> }[];
  let disposed: number;
  let clock: number;
  const logger: CloudLogger = { info: (message, data) => logs.push({ message, data }), warn: (message, data) => logs.push({ message, data }) };

  const open = async (extra: { timeoutMs?: number; maxFps?: number } = {}) => {
    const win = new LoginWindow({
      page,
      context,
      cdp,
      viewport: { width: 1280, height: 800 },
      timeoutMs: extra.timeoutMs ?? 300_000,
      maxFps: extra.maxFps,
      now: () => new Date(clock),
      logger,
      onDispose: () => {
        disposed++;
      },
    });
    await win.start();
    return win;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = Date.parse("2026-10-29T10:00:00Z");
    cdp = new FakeCdp();
    page = new FakePage();
    context = new FakeContext();
    logs = [];
    disposed = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("démarre la capture CDP en JPEG qualité 60", async () => {
    const win = await open();
    expect(cdp.sent[0]).toEqual({ method: "Page.startScreencast", params: { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 } });
    expect(win.status).toBe("open");
    expect(win.expiresAt.toISOString()).toBe("2026-10-29T10:05:00.000Z");
  });

  it("transmet les images (base64 + dimensions) et limite la cadence par l'acquittement", async () => {
    const win = await open({ maxFps: 4 });
    const frames: ScreencastFrame[] = [];
    const off = win.onFrame((f) => frames.push(f));
    cdp.emit("Page.screencastFrame", frame(1));
    expect(frames).toEqual([{ data: "AAAA", width: 1280, height: 800, at: clock }]);
    expect(cdp.methods().filter((m) => m === "Page.screencastFrameAck")).toHaveLength(1);
    // Image suivante 50 ms plus tard : acquittement retardé à 250 ms (4 images/s).
    clock += 50;
    cdp.emit("Page.screencastFrame", frame(2));
    expect(frames).toHaveLength(2);
    expect(cdp.methods().filter((m) => m === "Page.screencastFrameAck")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(cdp.methods().filter((m) => m === "Page.screencastFrameAck")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cdp.sent.at(-1)).toEqual({ method: "Page.screencastFrameAck", params: { sessionId: 2 } });
    off();
    cdp.emit("Page.screencastFrame", frame(3));
    expect(frames).toHaveLength(2);
    await win.cancel();
  });

  it("borne la cadence entre 2 et 4 images par seconde", async () => {
    const win = await open({ maxFps: 30 });
    cdp.emit("Page.screencastFrame", frame(1));
    clock += 10;
    cdp.emit("Page.screencastFrame", frame(2));
    await vi.advanceTimersByTimeAsync(239);
    expect(cdp.methods().filter((m) => m === "Page.screencastFrameAck")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cdp.methods().filter((m) => m === "Page.screencastFrameAck")).toHaveLength(2);
    await win.cancel();
  });

  it("relaie souris, clavier et texte en commandes Input.* sans jamais les journaliser", async () => {
    const win = await open();
    await win.dispatchInput({ type: "mouse", action: "down", x: 100, y: 200 });
    await win.dispatchInput({ type: "key", action: "down", key: "s", code: "KeyS", keyCode: 83, text: "s" });
    await win.dispatchInput({ type: "key", action: "up", key: "s", code: "KeyS", keyCode: 83 });
    await win.dispatchInput({ type: "text", text: "MotDePasse-Secret!" });
    const inputs = cdp.sent.filter((s) => s.method.startsWith("Input."));
    expect(inputs).toEqual([
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 100, y: 200, button: "left", clickCount: 1, modifiers: 0 } },
      { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, text: "s", unmodifiedText: "s", modifiers: 0 } },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, modifiers: 0 } },
      { method: "Input.insertText", params: { text: "MotDePasse-Secret!" } },
    ]);
    const journal = JSON.stringify(logs);
    expect(journal).not.toContain("MotDePasse");
    expect(journal).not.toContain("KeyS");
    await win.cancel();
  });

  it("refuse un événement invalide ou un échec du navigateur sans en citer le contenu", async () => {
    const win = await open();
    await expect(win.dispatchInput({ type: "text", text: "" })).rejects.toBeInstanceOf(LoginInputError);
    await expect(win.dispatchInput({ type: "mouse", action: "down", x: -5, y: 1 })).rejects.toBeInstanceOf(LoginInputError);
    cdp.failNext = true;
    const err = await win.dispatchInput({ type: "text", text: "secret-123" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoginInputError);
    expect(String((err as Error).message)).not.toContain("secret-123");
    expect(JSON.stringify(logs)).not.toContain("secret-123");
    await win.cancel();
  });

  it("isLoggedIn : jamais sur les pages de connexion, puis menu membre ou cookie de session Vinted", async () => {
    const win = await open();
    context.cookieJar = [{ name: "access_token_web", value: "tok", domain: ".vinted.fr" }];
    expect(await win.isLoggedIn()).toBe(false); // encore sur /member/signup
    page.currentUrl = "https://www.vinted.fr/member/login";
    expect(await win.isLoggedIn()).toBe(false);
    page.currentUrl = "https://www.vinted.fr/";
    expect(await win.isLoggedIn()).toBe(true);
    context.cookieJar = [{ name: "access_token_web", value: "tok", domain: ".google.com" }];
    expect(await win.isLoggedIn()).toBe(false);
    page.visible.add('[data-testid="header--user-menu"]');
    expect(await win.isLoggedIn()).toBe(true);
    page.currentUrl = "https://accounts.google.com/";
    expect(await win.isLoggedIn()).toBe(false);
    await win.cancel();
  });

  it("finish rend l'état filtré (vinted.* seulement) puis ferme tout", async () => {
    const win = await open();
    const statuses: LoginWindowStatus[] = [];
    win.onClose((s) => statuses.push(s));
    context.raw = {
      cookies: [
        { name: "access_token_web", value: "tok", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "SID", value: "google", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
      ],
      origins: [
        { origin: "https://www.vinted.fr", localStorage: [{ name: "k", value: "v" }] },
        { origin: "https://accounts.google.com", localStorage: [{ name: "g", value: "x" }] },
      ],
    };
    const state = await win.finish();
    expect(state.cookies.map((c) => c.name)).toEqual(["access_token_web"]);
    expect(state.origins.map((o) => o.origin)).toEqual(["https://www.vinted.fr"]);
    expect(win.status).toBe("finished");
    expect(statuses).toEqual(["finished"]);
    expect(cdp.methods()).toContain("Page.stopScreencast");
    expect(cdp.detached).toBe(true);
    expect(context.closed).toBe(true);
    expect(disposed).toBe(1);
    await expect(win.finish()).rejects.toBeInstanceOf(LoginWindowClosedError);
    await expect(win.dispatchInput({ type: "text", text: "a" })).rejects.toBeInstanceOf(LoginWindowClosedError);
    expect(JSON.stringify(logs)).not.toContain("tok");
  });

  it("blockSignal : CAPTCHA, blocage ou trop de requêtes pendant la connexion, jamais la page de connexion elle-même", async () => {
    const win = await open();
    // Page de connexion ordinaire (champ mot de passe) : pas un signal.
    expect(await win.blockSignal()).toBeNull();
    page.html = `<html><head><title>Vinted</title></head><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>`;
    expect(await win.blockSignal()).toMatchObject({ code: "captcha" });
    page.html = "<html><head><title>Trop de requêtes</title></head><body><h1>Trop de requêtes</h1></body></html>";
    expect(await win.blockSignal()).toMatchObject({ code: "rate_limited" });
    page.currentUrl = "https://geo.captcha-delivery.com/captcha/";
    page.html = "<html><body></body></html>";
    expect(await win.blockSignal()).toMatchObject({ code: "captcha" });
    // Le contenu de la page n'est jamais journalisé.
    expect(JSON.stringify(logs)).not.toContain("captcha-delivery");
    await win.cancel();
    expect(await win.blockSignal()).toBeNull();
  });

  it("fermeture « refused » (navigation hors liste) : rien n'est rendu, nettoyage fait", async () => {
    const win = await open();
    const statuses: LoginWindowStatus[] = [];
    win.onClose((s) => statuses.push(s));
    await win.close("refused");
    expect(win.status).toBe("refused");
    expect(statuses).toEqual(["refused"]);
    expect(disposed).toBe(1);
    await expect(win.finish()).rejects.toBeInstanceOf(LoginWindowClosedError);
  });

  it("expire après le délai (CLOUD_LOGIN_TIMEOUT_MS) et nettoie une seule fois", async () => {
    const win = await open({ timeoutMs: 60_000 });
    const statuses: LoginWindowStatus[] = [];
    win.onClose((s) => statuses.push(s));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(win.status).toBe("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(win.status).toBe("expired");
    expect(statuses).toEqual(["expired"]);
    await win.cancel();
    expect(win.status).toBe("expired");
    expect(disposed).toBe(1);
    expect(context.closed).toBe(true);
    expect(await win.isLoggedIn()).toBe(false);
  });
});

describe("toCdpInput", () => {
  it("molette, déplacement et touche sans caractère", () => {
    expect(toCdpInput({ type: "mouse", action: "wheel", x: 1, y: 2, deltaY: 120 })).toEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 1, y: 2, button: "none", clickCount: 0, modifiers: 0, deltaX: 0, deltaY: 120 },
    });
    expect(toCdpInput({ type: "mouse", action: "move", x: 3, y: 4 }).params.type).toBe("mouseMoved");
    expect(toCdpInput({ type: "key", action: "down", key: "Enter" })).toEqual({ method: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", key: "Enter", modifiers: 0 } });
  });
});
