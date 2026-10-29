import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { all, first, parseConversationPage, parseItemPage, text, type MinimalDocument } from "@selio/connectors/vinted-adapter";
import { InvalidSelectorError, LiveDomIncompleteError, readLiveDom, type DomHandle } from "./dom-bridge";

const fixture = (name: string) => readFileSync(new URL(`../../../connectors/src/vinted/fixtures/${name}`, import.meta.url), "utf8");

function load(html: string): Document {
  const w = new Window({ url: "https://www.vinted.fr/" });
  w.document.write(html);
  return w.document as unknown as Document;
}

/** `DomHandle` asynchrone au-dessus d'un DOM de test, avec un compteur d'appels « réseau ». */
function handleOf(node: Element | Document, stats: { calls: number; disposed: number }): DomHandle {
  const tick = async <T>(fn: () => T): Promise<T> => {
    stats.calls++;
    await Promise.resolve();
    return fn();
  };
  return {
    textContent: () => tick(() => node.textContent),
    getAttribute: (name) => tick(() => ("getAttribute" in node ? (node as Element).getAttribute(name) : null)),
    querySelector: (selector) =>
      tick(() => {
        let el: Element | null;
        try {
          el = node.querySelector(selector);
        } catch {
          throw new InvalidSelectorError();
        }
        return el ? handleOf(el, stats) : null;
      }),
    querySelectorAll: (selector) =>
      tick(() => {
        let list: Element[];
        try {
          list = Array.from(node.querySelectorAll(selector));
        } catch {
          throw new InvalidSelectorError();
        }
        return list.map((el) => handleOf(el, stats));
      }),
    dispose: async () => {
      stats.disposed++;
    },
  };
}

describe("readLiveDom — l'adaptateur v1 sur une page distante", () => {
  it("donne exactement le résultat de parseConversationPage sur la fixture", async () => {
    const doc = load(fixture("conversation-page.v1.html"));
    const url = "https://www.vinted.fr/inbox/987";
    const direct = parseConversationPage(doc as unknown as MinimalDocument, url);
    const stats = { calls: 0, disposed: 0 };
    const live = await readLiveDom(handleOf(doc, stats), (d) => parseConversationPage(d, url));
    expect(live).toEqual(direct);
    expect(live.ok).toBe(true);
    expect(live.data?.messages).toHaveLength(2);
    expect(live.data?.composerFound).toBe(true);
    expect(stats.calls).toBeGreaterThan(0);
    expect(stats.disposed).toBeGreaterThan(0);
  });

  it("fonctionne aussi pour une page article et une page inconnue", async () => {
    for (const [name, parse, url] of [
      ["item-page.v1.html", parseItemPage, "https://www.vinted.fr/items/123456-veste"],
      ["unknown-page.html", parseItemPage, "https://www.vinted.fr/items/1"],
      ["unknown-page.html", parseConversationPage, "https://www.vinted.fr/inbox/1"],
    ] as const) {
      const doc = load(fixture(name));
      const direct = (parse as (d: MinimalDocument, u: string) => unknown)(doc as unknown as MinimalDocument, url);
      const live = await readLiveDom(handleOf(doc, { calls: 0, disposed: 0 }), (d) => (parse as (d: MinimalDocument, u: string) => unknown)(d, url));
      expect(live).toEqual(direct);
    }
  });

  it("un sélecteur refusé par le moteur lève une erreur, comme sur un vrai DOM (l'adaptateur passe au suivant)", async () => {
    const doc = load(`<main><h1>Titre</h1></main>`);
    const live = await readLiveDom(handleOf(doc, { calls: 0, disposed: 0 }), (d) => ({
      found: text(first(d, ["::nope[", "h1"])),
      many: all(d, ["][", "main"]).length,
    }));
    expect(live).toEqual({ found: "Titre", many: 1 });
  });

  it("borne le nombre de passages", async () => {
    const doc = load(`<div><div><div><div><span>x</span></div></div></div></div>`);
    const deep = (d: MinimalDocument) => {
      let el = d.querySelector("div");
      for (let i = 0; i < 4 && el; i++) el = el.querySelector("div") ?? el.querySelector("span");
      return text(el);
    };
    await expect(readLiveDom(handleOf(doc, { calls: 0, disposed: 0 }), deep, { maxPasses: 2 })).rejects.toBeInstanceOf(LiveDomIncompleteError);
    expect(await readLiveDom(handleOf(doc, { calls: 0, disposed: 0 }), deep)).toBe("x");
  });
});
