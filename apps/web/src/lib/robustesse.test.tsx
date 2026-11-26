import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@selio/ui";
import { MemoryDemoStorage } from "@selio/demo-data";
import { ApiClient, UNREADABLE_RESPONSE_MESSAGE, httpStatusMessage } from "./api/client";
import { DataError } from "./data/types";
import { DemoClient } from "./demo/client";
import { UNEXPECTED_ERROR_MESSAGE, errorMessage } from "./errors";
import { landingPath, splitReturnPath } from "./admin";
import { formatBytes, photoFileProblem } from "./photo-files";
import { announceSession, onSessionEvent } from "./session-sync";
import { useAppMutation } from "../app/components/hooks";

/**
 * Robustesse avant lancement côté navigateur (docs/ROBUSTESSE.md) : erreurs toujours lisibles, double clic,
 * retour à la page demandée après connexion, photos contrôlées avant l'envoi, deux onglets.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = "https://api.selio.example";
const client = () => new ApiClient(BASE);

describe("erreurs serveur : jamais « Erreur 500 », JSON brut ni texte technique", () => {
  it("page HTML d'un proxy en 500, corps vide, message anglais : message clair en français", async () => {
    const replies = [
      new Response("<html><body>Internal Server Error</body></html>", { status: 500, headers: { "content-type": "text/html" } }),
      new Response("", { status: 500 }),
      new Response(JSON.stringify({ error: { code: "internal", message: "Erreur interne du serveur." } }), { status: 500 }),
      new Response(JSON.stringify({ message: "Rate limit exceeded, retry in 1 minute" }), { status: 429 }),
      new Response("TypeError: Cannot read properties of undefined\n    at handler (/srv/app.js:12:3)", { status: 400 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift()!));
    const messages: string[] = [];
    for (let i = 0; i < 5; i++) messages.push(((await client().createItem({ title: "x" }).catch((e: unknown) => e)) as DataError).message);
    expect(messages.slice(0, 3)).toEqual([httpStatusMessage(500), httpStatusMessage(500), httpStatusMessage(500)]);
    expect(messages[3]).toBe(httpStatusMessage(429));
    expect(messages[4]).toBe(httpStatusMessage(400));
    for (const m of messages) expect(m).not.toMatch(/Erreur \d{3}|Internal Server Error|Rate limit|TypeError|[{<]/);
  });

  it("le message français du serveur est gardé tel quel ; une réponse 200 illisible a un message clair", async () => {
    const replies = [
      new Response(JSON.stringify({ error: { code: "item_conflict", message: "Cet article a été modifié entre-temps." } }), { status: 409 }),
      new Response("<html>ok</html>", { status: 200 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift()!));
    await expect(client().updateItem("a", { title: "x" })).rejects.toMatchObject({ code: "item_conflict", status: 409, message: "Cet article a été modifié entre-temps." });
    await expect(client().createItem({ title: "x" })).rejects.toMatchObject({ message: UNREADABLE_RESPONSE_MESSAGE });
  });

  it("erreur du navigateur ou du code (TypeError, « Failed to fetch ») : message général, jamais le texte technique", () => {
    expect(errorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(errorMessage(new Error("Failed to fetch"))).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(errorMessage({ message: "" })).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(errorMessage(42)).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(errorMessage(new Error("« veste.heic » est au format HEIC (iPhone)."))).toBe("« veste.heic » est au format HEIC (iPhone).");
    expect(errorMessage(new DataError("validation", "Prix affiché : au moins 1 €.", 400))).toBe("Prix affiché : au moins 1 €.");
  });
});

describe("double clic : une seule mutation pour les mêmes variables", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
    return <QueryClientProvider client={qc}><ToastProvider>{children}</ToastProvider></QueryClientProvider>;
  }

  it("deux appels identiques pendant la requête → un seul envoi ; d'autres variables passent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fn = vi.fn(async (v: { id: string }) => { await gate; return v.id; });
    const { result } = renderHook(() => useAppMutation(fn), { wrapper });
    let p1!: Promise<string>, p2!: Promise<string>;
    act(() => {
      p1 = result.current.mutateAsync({ id: "a" });
      p2 = result.current.mutateAsync({ id: "a" });
      result.current.mutate({ id: "a" });
      result.current.mutate({ id: "b" });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([{ id: "a" }, { id: "b" }]);
    expect(p2).toBe(p1);
    await act(async () => { release(); await p1; });
    // La requête terminée, un nouveau clic (volontaire) repart.
    await act(async () => { await result.current.mutateAsync({ id: "a" }); });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("lien reçu alors que l'on est déconnecté : retour à la page demandée après connexion", () => {
  const client = { user: { isOperator: false, operatorRole: null }, mode: "connected" } as const;
  const operator = { user: { isOperator: true, operatorRole: "tech" }, mode: "connected" } as const;

  it("page profonde, paramètres et ancre gardés ; adresse externe ou inconnue refusée", () => {
    expect(landingPath(client as never, "/app/items/0f8b1c2e-1d2c-4b5a-9e7f-123456789abc")).toBe("/app/items/0f8b1c2e-1d2c-4b5a-9e7f-123456789abc");
    expect(landingPath(client as never, "/app/settings/billing?plan=pro&cycle=yearly#offres")).toBe("/app/settings/billing?plan=pro&cycle=yearly#offres");
    expect(landingPath(client as never, "/app/radar/affaires/abc")).toBe("/app/radar/affaires/abc");
    expect(landingPath(client as never, "//evil.example/app")).toBe("/app/espaces");
    expect(landingPath(client as never, "https://evil.example/app/items")).toBe("/app/espaces");
    expect(landingPath(client as never, "/admin/comptes")).toBe("/app/espaces");
    expect(landingPath(operator as never, "/admin/comptes/abc-123")).toBe("/admin/comptes/abc-123");
    expect(landingPath(client as never, "/app/items?q=a b")).toBe("/app/items");
    expect(splitReturnPath("/app/items?status=listed")).toEqual({ path: "/app/items", rest: "?status=listed" });
  });
});

describe("photo choisie : contrôlée avant toute lecture complète", () => {
  const file = (bytes: number[] | string, name: string, type = "image/jpeg") => new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });

  it("vide, trop lourde (taille annoncée avec la limite), PDF renommé, HEIC, SVG ; vraie image acceptée", async () => {
    const max = 1_500_000;
    expect(await photoFileProblem(file([], "vide.jpg"), { maxBytes: max })).toMatch(/vide \(0 octet\)/);
    // Fichier de plusieurs Go : refusé sur sa taille, jamais lu (seule la taille est consultée).
    const huge = { size: 3_000_000_000, name: "film.jpg", slice: () => { throw new Error("ne doit pas être lu"); } } as unknown as File;
    expect(await photoFileProblem(huge, { maxBytes: max })).toBe(`« film.jpg » est trop lourde (3 Go) : ${formatBytes(max)} au maximum.`);
    expect(await photoFileProblem(file("%PDF-1.7 facture", "facture.jpg"), { maxBytes: max })).toMatch(/document PDF/);
    expect(await photoFileProblem(file([0, 0, 0, 0x18, ...Array.from("ftypheic").map((c) => c.charCodeAt(0)), 0, 0, 0, 0], "IMG_0001.jpg", "image/heic"), { maxBytes: max })).toMatch(/HEIC/);
    expect(await photoFileProblem(file('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "logo.png", "image/png"), { maxBytes: max })).toMatch(/SVG/);
    expect(await photoFileProblem(file("pas une image du tout", "photo.webp", "image/webp"), { maxBytes: max })).toMatch(/n'est pas une image lisible/);
    expect(await photoFileProblem(file([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3], "veste.jpg"), { maxBytes: max })).toBeNull();
    expect(await photoFileProblem(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], "dos.png", "image/png"), { maxBytes: max })).toBeNull();
  });
});

describe("deux onglets", () => {
  it("démonstration : modification concurrente d'un article signalée, jamais écrasée en silence", async () => {
    const storage = new MemoryDemoStorage();
    const a = new DemoClient(storage);
    await a.login({ email: "marie@demo.selio.local", password: "demo" });
    const item = (await a.listItems({ pageSize: 1 })).items[0]!;
    await a.updateItem(item.id, { title: "Titre de l'onglet A", expectedUpdatedAt: item.updatedAt });
    await expect(a.updateItem(item.id, { title: "Titre de l'onglet B", expectedUpdatedAt: item.updatedAt })).rejects.toMatchObject({ code: "item_conflict", status: 409 });
    expect((await a.getItem(item.id)).title).toBe("Titre de l'onglet A");
  });

  it("démonstration : l'état enregistré par l'autre onglet est relu ; un onglet déconnecté le reste", async () => {
    // Stockage sérialisé (comme localStorage) : chaque onglet a sa propre copie en mémoire.
    let saved: string | null = null;
    const storage = { load: () => (saved ? JSON.parse(saved) : null), save: (st: unknown) => { saved = JSON.stringify(st); }, clear: () => { saved = null; } };
    const a = new DemoClient(storage);
    await a.login({ email: "marie@demo.selio.local", password: "demo" });
    const b = new DemoClient(storage);
    const item = (await a.listItems({ pageSize: 1 })).items[0]!;
    await a.updateItem(item.id, { title: "Modifié dans l'onglet A" });
    expect((await b.getItem(item.id)).title).not.toBe("Modifié dans l'onglet A");
    b.syncFromStorage();
    expect((await b.getItem(item.id)).title).toBe("Modifié dans l'onglet A");
    b.forgetSession();
    expect(await b.getSession()).toBeNull();
    b.syncFromStorage();
    expect(await b.getSession()).toBeNull();
  });

  it("déconnexion annoncée aux autres onglets (jamais à l'onglet émetteur)", async () => {
    const received: string[] = [];
    // Deux « onglets » : le second écoute un canal distinct du même nom (comme un autre onglet du navigateur).
    const other = typeof BroadcastChannel === "function" ? new BroadcastChannel("selio.session") : null;
    const fromOther = new Promise<string>((resolve) => other?.addEventListener("message", (e) => resolve((e as MessageEvent).data.kind)));
    const off = onSessionEvent((e) => received.push(e.kind));
    announceSession("logout");
    if (other) expect(await fromOther).toBe("logout");
    // L'onglet émetteur n'est jamais déconnecté par son propre message.
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([]);
    off();
    other?.close();
  });
});
