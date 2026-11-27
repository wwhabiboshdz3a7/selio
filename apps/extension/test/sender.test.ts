import { describe, expect, it } from "vitest";
import { senderAllowed } from "../src/background/sender";

const ext = { id: "abcdefghijklmnopabcdefghijklmnop", baseUrl: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/" };
const optionsUrl = `${ext.baseUrl}options.html`;

describe("senderAllowed", () => {
  it("accepte la page d'options ouverte dans un onglet (association du jeton)", () => {
    expect(senderAllowed({ id: ext.id, url: optionsUrl, tab: { url: optionsUrl } }, false, ext)).toBe(true);
  });

  it("accepte la popup (sans onglet)", () => {
    expect(senderAllowed({ id: ext.id, url: `${ext.baseUrl}popup.html` }, false, ext)).toBe(true);
  });

  it("refuse qu'un script de page Vinted envoie un message réservé aux pages de l'extension", () => {
    const vinted = "https://www.vinted.fr/items/1-veste";
    expect(senderAllowed({ id: ext.id, url: vinted, tab: { url: vinted } }, false, ext)).toBe(false);
  });

  it("accepte une capture depuis un onglet Vinted, la refuse ailleurs", () => {
    const vinted = "https://www.vinted.fr/items/1-veste";
    expect(senderAllowed({ id: ext.id, url: vinted, tab: { url: vinted } }, true, ext)).toBe(true);
    expect(senderAllowed({ id: ext.id, url: "https://evil.example/", tab: { url: "https://evil.example/" } }, true, ext)).toBe(false);
    expect(senderAllowed({ id: ext.id, url: optionsUrl, tab: { url: optionsUrl } }, true, ext)).toBe(false);
  });

  it("refuse une autre extension", () => {
    expect(senderAllowed({ id: "autre", url: optionsUrl }, false, ext)).toBe(false);
  });
});
