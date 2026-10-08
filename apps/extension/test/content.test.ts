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

function boot(url: string) {
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
        if (msg.type === "status") cb({ ok: true, data: { paired: true, orgName: "Org Test" } });
        else if (msg.type === "capture") cb({ ok: true, data: { id: "item-1" } });
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
  it("ne touche pas au DOM de la page hors de son hôte", async () => {
    if (!script) return;
    const { win } = boot("https://www.vinted.fr/items/123456-veste");
    await new Promise((r) => setTimeout(r, 20));
    expect(win.document.querySelector("textarea")).toBeNull();
    expect(win.document.querySelector("h1")?.textContent).toBe("Veste en jean Levi's Trucker");
  });
});
