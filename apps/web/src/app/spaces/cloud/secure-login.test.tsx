import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_CONSENT_VERSION } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import type { CloudAccountView } from "../../../lib/data/types";
import { LOGIN_PRIVACY_NOTICE, SecureLoginWindow } from "./SecureLoginWindow";

/** Faux WebSocket : garde ce que l'application envoie, simule ce que le serveur répond. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = "blob";
  sent: string[] = [];
  closed = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  messages() {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const ACCOUNT: CloudAccountView = {
  id: "acc-1", orgId: "org-1", connectionId: "conn-1", status: "needs_login", pausedReason: null, pausedAt: null, hasSession: false, sessionSavedAt: null, lastActionAt: null, warningsCount: 0, settings: { levels: ["light"] },
  createdAt: "2026-10-29T10:00:00Z", updatedAt: "2026-10-29T10:00:00Z", connectionLabel: "Boutique principale", displayHandle: "atelier.secondemain", actionsToday: 0,
};
const TICKET = "T".repeat(43);
const SECRET = "s3cret!";
const PASTED = "motdepasse-colle";

type Call = { method: string; url: string };
let calls: Call[];

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

beforeEach(() => {
  FakeSocket.instances = [];
  calls = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url });
    if (url.endsWith(`/api/cloud/accounts/${ACCOUNT.id}/login`)) {
      return new Response(JSON.stringify({ loginSessionId: "login-1", ticket: TICKET, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }), { status: 200 });
    }
    if (url.endsWith("/api/cloud/login/login-1/cancel")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ error: { code: "not_found", message: "introuvable" } }), { status: 404 });
  }));
  queryClient.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return <SecureLoginWindow account={ACCOUNT} open={open} onClose={() => { onClose?.(); setOpen(false); }} />;
}

async function openConnected(onClose?: () => void) {
  render(<DataProvider forceMode="connected"><Harness onClose={onClose} /></DataProvider>);
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  const sock = FakeSocket.instances[0]!;
  act(() => {
    sock.open();
    sock.receive({ type: "ready", loginSessionId: "login-1", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
    sock.receive({ type: "frame", data: "AAAA", width: 1280, height: 800 });
  });
  const canvas = await screen.findByTestId("cloud-login-canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  return { sock, canvas: canvas as HTMLCanvasElement, capture: screen.getByTestId("cloud-login-capture") as HTMLTextAreaElement };
}

describe("fenêtre de connexion sécurisée (mode connecté)", () => {
  it("ouvre le WebSocket avec le ticket, relaie souris et clavier à l'échelle, sans jamais journaliser une frappe", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { sock, canvas, capture } = await openConnected();
    expect(calls[0]).toEqual({ method: "POST", url: `/api/cloud/accounts/${ACCOUNT.id}/login` });
    expect(sock.url).toMatch(new RegExp(`^wss?://[^/]+/api/cloud/login/login-1/ws\\?ticket=${TICKET}$`));
    // Bandeau explicite, et le ticket n'est jamais affiché.
    expect(screen.getByTestId("cloud-login-notice").textContent).toBe(LOGIN_PRIVACY_NOTICE);
    expect(document.body.textContent).not.toContain(TICKET);

    fireEvent.pointerMove(canvas, { clientX: 320, clientY: 200 });
    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 200, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 200, button: 0 });
    fireEvent.wheel(canvas, { clientX: 320, clientY: 200, deltaY: 120 });
    for (const ch of SECRET) {
      fireEvent.keyDown(capture, { key: ch });
      fireEvent.keyUp(capture, { key: ch });
    }
    fireEvent.keyDown(capture, { key: "Enter", code: "Enter", keyCode: 13 });
    fireEvent.keyDown(capture, { key: "v", ctrlKey: true });
    fireEvent.paste(capture, { clipboardData: { getData: () => PASTED } });

    const msgs = sock.messages();
    expect(msgs[0]).toEqual({ type: "mouse", action: "move", x: 640, y: 400, button: "none", clickCount: 0, modifiers: 0 });
    expect(msgs).toContainEqual({ type: "mouse", action: "down", x: 640, y: 400, button: "left", clickCount: 1, modifiers: 0 });
    expect(msgs).toContainEqual({ type: "mouse", action: "up", x: 640, y: 400, button: "left", clickCount: 1, modifiers: 0 });
    expect(msgs.filter((m) => m.type === "mouse" && m.action === "wheel")).toHaveLength(1);
    expect(msgs.filter((m) => m.type === "key" && m.action === "down" && m.text !== "\r").map((m) => m.text).join("")).toBe(SECRET);
    expect(msgs).toContainEqual(expect.objectContaining({ type: "key", action: "down", key: "Enter", text: "\r" }));
    // Ctrl+V n'est pas transmis : le texte collé part en « insertText ».
    expect(msgs.some((m) => m.type === "key" && m.key === "v")).toBe(false);
    expect(msgs).toContainEqual({ type: "text", text: PASTED });
    expect(document.activeElement).toBe(capture);

    // Rien n'est gardé ni affiché ni journalisé.
    expect(capture.value).toBe("");
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(PASTED);
    for (const spy of spies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain(PASTED);
      expect(logged).not.toContain(TICKET);
    }
    for (const ch of SECRET) expect(spies.some((s) => s.mock.calls.some((c) => c.includes(ch)))).toBe(false);
  });

  it("connexion détectée, puis session enregistrée : la fenêtre se ferme seule", async () => {
    const onClose = vi.fn();
    const { sock } = await openConnected(onClose);
    act(() => sock.receive({ type: "status", status: "logged_in" }));
    expect(await screen.findByText(/Connexion détectée : enregistrement de la session/)).toBeTruthy();
    act(() => sock.receive({ type: "done" }));
    expect(await screen.findByText(/Connexion détectée — session enregistrée/)).toBeTruthy();
    // Le serveur ferme ensuite la WebSocket : ce n'est pas une erreur.
    act(() => sock.onclose?.());
    expect(screen.queryByText(/interrompue/)).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 3000 });
    // Fermée après réussite : aucune annulation n'est envoyée.
    expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(false);
  });

  it("Annuler ferme le WebSocket, prévient le serveur et n'enregistre rien", async () => {
    const onClose = vi.fn();
    const { sock } = await openConnected(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", url: "/api/cloud/login/login-1/cancel" }));
    expect(sock.closed).toBe(true);
    expect(sock.messages().at(-1)).toEqual({ type: "cancel" });
  });

  it("expiration et erreurs du serveur : message clair, plus aucune saisie relayée", async () => {
    const { sock, capture } = await openConnected();
    act(() => sock.receive({ type: "closed", reason: "expired" }));
    expect(await screen.findByText(/La fenêtre a expiré/)).toBeTruthy();
    const before = sock.sent.length;
    fireEvent.keyDown(capture, { key: "x" });
    expect(sock.sent.length).toBe(before);
    // Plus rien à annuler : seul « Fermer » reste.
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Fermer" }).length).toBeGreaterThan(0);
    act(() => sock.receive({ type: "closed", reason: "unavailable" }));
    expect(await screen.findByText(/Le navigateur du Cloud est indisponible/)).toBeTruthy();
  });
});

describe("fenêtre de connexion sécurisée (démonstration)", () => {
  it("écran simulé : rien à saisir, aucun WebSocket, réussite après 3 secondes", async () => {
    const client = getDemoClient();
    await client.resetDemo();
    await client.login({ email: "marie@demo.selio.local", password: "demo" });
    const s = await client.getSession();
    await client.adminSetPlan(s!.org.id, "agence");
    await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
    const purchase = (await client.listConnections()).find((c) => c.usage === "purchase")!;
    await client.enableCloudAccount(purchase.id);
    const account = (await client.cloudAccounts()).find((a) => a.connectionId === purchase.id)!;
    expect(account.status).toBe("needs_login");
    queryClient.clear();
    render(<DataProvider forceMode="demo"><SecureLoginWindow account={account} open onClose={() => undefined} /></DataProvider>);
    const sim = await screen.findByTestId("cloud-login-simulated");
    expect(sim.textContent).toMatch(/rien n'est saisi, rien ne touche Vinted/);
    expect(sim.querySelector("input, textarea")).toBeNull();
    expect(screen.getByTestId("cloud-login-notice").textContent).toBe(LOGIN_PRIVACY_NOTICE);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(await screen.findByText(/session enregistrée/, {}, { timeout: 5000 })).toBeTruthy();
    expect((await client.cloudAccounts()).find((a) => a.id === account.id)).toMatchObject({ status: "active", hasSession: true });
  });
});
