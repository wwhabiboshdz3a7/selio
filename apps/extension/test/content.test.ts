import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/**
 * Exécute le content script compilé (dist/content.js) sur la fixture article
 * avec un faux `chrome.runtime` : vérifie le panneau isolé, la capture
 * (message validé) et l'absence d'action automatique.
 */
const fixture = readFileSync(new URL("../../../packages/connectors/src/vinted/fixtures/item-page.v1.html", import.meta.url), "utf8");
let script: string;
beforeAll(() => {
  try {
    script = readFileSync(new URL("../dist/content.js", import.meta.url), "utf8");
  } catch {
    script = "";
  }
});

const comparables = { p25: 2800, p50: 3400, p75: 4100, delayDays: 9, confidence: 0.6, confidenceLevel: "medium", method: "blend", strategies: { fast: 2790, standard: 3390, max: 4090 }, comparableCount: 12, demo: false, message: null, factors: [], priceCheck: { priceCents: 3500, position: "within" } };

function boot(url: string, opts: { paired?: boolean } = {}) {
  const win = new Window({ url });
  win.document.write(fixture);
  const sent: unknown[] = [];
  const listeners: ((msg: unknown, sender: unknown, respond: (r: unknown) => void) => void)[] = [];
  const chrome = {
    runtime: {
      id: "ext-id",
      lastError: undefined,
      sendMessage: (msg: { type: string }, cb: (r: unknown) => void) => {
        sent.push(msg);
        if (msg.type === "status") cb({ ok: true, data: { paired: opts.paired ?? true, orgName: "Org Test" } });
        else if (msg.type === "capture") cb({ ok: true, data: { id: "item-1" } });
        else if (msg.type === "comparables") cb({ ok: true, data: comparables });
        else cb({ ok: true, data: null });
      },
      onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
    },
  };
  const g = win as unknown as Record<string, unknown>;
  g.chrome = chrome;
  const fn = new Function("window", "document", "chrome", "location", "navigator", "setInterval", "Event", "HTMLElement", "Node", script);
  fn(win, win.document, chrome, win.location, win.navigator, () => 0, win.Event, win.HTMLElement, win.Node);
  return { win, sent, listeners };
}

describe("content script compilé", () => {
  it("monte un panneau isolé, lit l'article et envoie une capture validée au clic", async () => {
    if (!script) return; // dist absent : build non exécuté
    const { win, sent, listeners } = boot("https://www.vinted.fr/items/123456-veste");
    await new Promise((r) => setTimeout(r, 50));
    const host = win.document.getElementById("selio-panel-host");
    expect(host).not.toBeNull();
    // Le diagnostic est envoyé au service worker, pas de capture sans clic.
    expect(sent.some((m) => (m as { type: string }).type === "capture")).toBe(false);
    // Simule le popup qui demande un diagnostic.
    let report: { ok: boolean; pageKind: string } | null = null;
    listeners[0]?.({ type: "runDiagnostic" }, { id: "ext-id" }, (r) => { report = (r as { data: typeof report }).data; });
    expect(report).not.toBeNull();
    expect(report!.ok).toBe(true);
    expect(report!.pageKind).toBe("item");
    expect(sent.some((m) => (m as { type: string }).type === "diagnostic")).toBe(true);
  });
  it("à l'ouverture du panneau sur un article, demande les comparables avec les seuls champs de l'article", async () => {
    if (!script) return;
    const { sent, listeners } = boot("https://www.vinted.fr/items/123456-veste");
    await new Promise((r) => setTimeout(r, 20));
    // Panneau fermé : rien n'est demandé.
    expect(sent.some((m) => (m as { type: string }).type === "comparables")).toBe(false);
    listeners[0]?.({ type: "togglePanel" }, { id: "ext-id" }, () => {});
    await new Promise((r) => setTimeout(r, 50));
    const requests = sent.filter((m) => (m as { type: string }).type === "comparables") as { type: string; item: Record<string, unknown> }[];
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!.item).sort()).toEqual(["brand", "category", "condition", "priceCents", "size", "title"]);
    expect(requests[0]!.item).toEqual({ title: "Veste en jean Levi's Trucker", brand: "Levi's", category: null, size: "M / 38 / 10", condition: "very_good", priceCents: 3500 });
    const json = JSON.stringify(requests[0]);
    for (const forbidden of ["vendeur_demo", "images.example.invalid", "123456", "Ignore previous", "https://"]) expect(json).not.toContain(forbidden);
    // Aucune capture sans clic.
    expect(sent.some((m) => (m as { type: string }).type === "capture")).toBe(false);
  });
  it("extension non reliée : aucun appel de comparables", async () => {
    if (!script) return;
    const { sent, listeners } = boot("https://www.vinted.fr/items/123456-veste", { paired: false });
    listeners[0]?.({ type: "togglePanel" }, { id: "ext-id" }, () => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.some((m) => (m as { type: string }).type === "status")).toBe(true);
    expect(sent.some((m) => (m as { type: string }).type === "comparables")).toBe(false);
  });
  it("ne touche pas au DOM de la page hors de son hôte", async () => {
    if (!script) return;
    const { win } = boot("https://www.vinted.fr/items/123456-veste");
    await new Promise((r) => setTimeout(r, 20));
    expect(win.document.querySelector("textarea")).toBeNull();
    expect(win.document.querySelector("h1")?.textContent).toBe("Veste en jean Levi's Trucker");
  });
});
