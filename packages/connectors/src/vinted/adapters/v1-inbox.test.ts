import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { parseHtmlDocument } from "./html";
import {
  INBOX_RECENT_FALLBACK,
  conversationApiRef,
  eurAmountCents,
  inboxLinkRef,
  inboxPageDiagnostic,
  isInboxApiPath,
  parseConversationApiPayload,
  parseInboxApiPayload,
  parseInboxDocumentLoose,
  parseVintedTime,
  selectConversationsToOpen,
  type InboxListEntry,
} from "./v1-inbox";

/**
 * Adaptateur de la messagerie sur des données SYNTHÉTIQUES (aucune page réelle de Vinted n'a été
 * observée) : structures plausibles, pseudos et textes inventés pour le test.
 */
const PAGE = "https://www.vinted.fr/inbox";

const INBOX_JSON = JSON.stringify({
  conversations: [
    { id: 111, unread: true, updated_at: "2026-11-27T09:10:00+01:00", opposite_user: { id: 9001, login: "acheteuse_test" }, item_id: 555 },
    { id: "222", unread_count: 0, updated_at: "2026-11-27T08:00:00+01:00", opposite_user: { login: "autre_test" } },
    { id: 333, is_unread: false, opposite_user: { login: "<b>pseudo</b>" } },
    { id: "pas-un-id" },
    { id: 111, unread: true },
  ],
});

const CONVERSATION_JSON = JSON.stringify({
  conversation: {
    id: 111,
    opposite_user: { id: 9001, login: "acheteuse_test" },
    transaction: { item_id: 555 },
    messages: [
      { entity_type: "message", entity: { body: "Bonjour, toujours dispo ?", user_id: 9001 }, created_at_ts: "2026-11-27T09:00:00+01:00" },
      { entity_type: "message", entity: { body: "Oui !", user_id: 42 }, created_at_ts: "2026-11-27T09:05:00+01:00" },
      { entity_type: "offer_request_message", entity: { user_id: 9001, price: { amount: "18.50", currency_code: "EUR" } }, created_at_ts: "2026-11-27T09:08:00+01:00" },
      { entity_type: "offer_request_message", entity: { body: "Et en livres ?", user_id: 9001, price: { amount: "15.0", currency_code: "GBP" } }, created_at_ts: "2026-11-27T09:09:00+01:00" },
      { entity_type: "status_message", entity: { title: "Commande en cours" } },
      { entity_type: "message", entity: { body: "auteur inconnu" } },
    ],
  },
});

describe("messagerie Vinted v1 : JSON chargé par la page (synthétique)", () => {
  it("liste : identifiant, statut « non lu » sous ses diverses formes, pseudo nettoyé, doublons et identifiants invalides écartés", () => {
    const r = parseInboxApiPayload(INBOX_JSON)!;
    expect(r.source).toBe("api");
    expect(r.entries.map((e) => [e.ref, e.unread])).toEqual([["111", true], ["222", false], ["333", false]]);
    expect(r.entries[0]).toMatchObject({ buyerHandle: "acheteuse_test", itemExternalRef: "555", lastMessageAt: "2026-11-27T08:10:00.000Z" });
    expect(r.entries[2]!.buyerHandle).toBeNull();
    expect(r.skipped).toBe(2);
    expect(parseInboxApiPayload("{}")).toBeNull();
    expect(parseInboxApiPayload("pas du json")).toBeNull();
  });

  it("conversation : direction par l'auteur, offre en euros seulement, messages sans direction ou sans texte écartés", () => {
    const c = parseConversationApiPayload(CONVERSATION_JSON, "111")!;
    expect(c).toMatchObject({ ref: "111", buyerHandle: "acheteuse_test", itemExternalRef: "555" });
    expect(c.messages.map((m) => [m.direction, m.body, m.offerCents])).toEqual([
      ["inbound", "Bonjour, toujours dispo ?", null],
      ["outbound", "Oui !", null],
      ["inbound", "Offre : 18,50 €", 1850],
      // Offre en livres : le texte est gardé, le montant ignoré (jamais converti, jamais pris pour des euros).
      ["inbound", "Et en livres ?", null],
    ]);
    expect(c.skipped).toBe(2);
    // Une autre conversation que celle attendue n'est pas acceptée.
    expect(parseConversationApiPayload(CONVERSATION_JSON, "999")).toBeNull();
  });

  it("direction par drapeau explicite ou par l'utilisateur courant ; dates Unix acceptées", () => {
    const json = JSON.stringify({ conversation: { id: 7, current_user_id: 42, messages: [{ body: "Salut", user_id: 42, created_at: 1764230400 }, { body: "Bonjour", is_own: false }] } });
    const c = parseConversationApiPayload(json)!;
    expect(c.messages.map((m) => m.direction)).toEqual(["outbound", "inbound"]);
    expect(c.messages[0]!.at).toBe("2025-11-27T08:00:00.000Z");
  });

  it("montants : la devise doit être dite et valoir EUR", () => {
    expect(eurAmountCents({ amount: "12,5", currency_code: "EUR" })).toBe(1250);
    expect(eurAmountCents({ amount: "12.5", currency_code: "PLN" })).toBeNull();
    expect(eurAmountCents("12.5")).toBeNull();
    expect(eurAmountCents("12.5", "eur")).toBe(1250);
    expect(eurAmountCents({ amount: -3, currency_code: "EUR" })).toBeNull();
    expect(parseVintedTime("hier")).toBeNull();
    expect(parseVintedTime(5)).toBeNull();
  });

  it("chemins des réponses JSON reconnues", () => {
    expect(isInboxApiPath("/api/v2/inbox")).toBe(true);
    expect(isInboxApiPath("/api/v2/inbox/")).toBe(true);
    expect(isInboxApiPath("/api/v2/inboxes")).toBe(false);
    expect(conversationApiRef("/api/v2/conversations/123")).toBe("123");
    expect(conversationApiRef("/api/v2/conversations/123/archive")).toBeNull();
  });
});

const LIST_HTML = `<!doctype html><html><head><title>Messages</title></head><body><main>
<ul data-testid="inbox-list">
  <li data-testid="inbox-item-1"><a href="/inbox/1001"><span>Léa (test)</span><span data-testid="inbox-item-unread-badge">1</span></a></li>
  <li data-testid="inbox-item-2"><a href="/inbox/1002"><span>Paul (test)</span></a></li>
  <li><a href="https://www.vinted.fr/inbox/1003" aria-label="Conversation non lue">Zoé</a></li>
  <li><a href="https://evil.example.com/inbox/6666">Faux</a></li>
  <li><a href="http://www.vinted.fr/inbox/7777">Sans https</a></li>
  <li><a href="/inbox">Toute la messagerie</a></li>
</ul></main></body></html>`;

const LIST_NO_HINT = `<!doctype html><html><body><nav><a href="/inbox/1">a</a><a href="/inbox/2">b</a><a href="/inbox/3">c</a><a href="/inbox/4">d</a></nav></body></html>`;

function happy(html: string) {
  const w = new Window();
  w.document.write(html);
  return w.document as unknown as Parameters<typeof parseInboxDocumentLoose>[0];
}

describe("messagerie Vinted v1 : lecture souple du HTML (synthétique)", () => {
  it("liens du même site seulement ; indices « non lu » par ligne ; mêmes résultats sur happy-dom et sur le lecteur HTML", () => {
    for (const doc of [parseHtmlDocument(LIST_HTML), happy(LIST_HTML)]) {
      const r = parseInboxDocumentLoose(doc, PAGE)!;
      expect(r.source).toBe("dom");
      expect(r.entries.map((e) => [e.ref, e.unread])).toEqual([["1001", true], ["1002", false], ["1003", true]]);
      expect(r.entries.every((e) => e.buyerHandle === null)).toBe(true);
    }
  });

  it("lien d'un autre site ignoré, même s'il ressemble à une conversation", () => {
    expect(inboxLinkRef("https://evil.example.com/inbox/1", PAGE)).toBeNull();
    expect(inboxLinkRef("https://www.vinted.fr.evil.com/inbox/1", PAGE)).toBeNull();
    expect(inboxLinkRef("https://user:pw@www.vinted.fr/inbox/1", PAGE)).toBeNull();
    expect(inboxLinkRef("/inbox/12", PAGE)).toBe("12");
    expect(inboxLinkRef("https://www.vinted.be/inbox/12", PAGE)).toBe("12");
    expect(inboxLinkRef("/inbox/12/details", PAGE)).toBeNull();
  });

  it("aucun indice dans la page : statut inconnu, les 3 plus récentes sont ouvertes", () => {
    const r = parseInboxDocumentLoose(parseHtmlDocument(LIST_NO_HINT), PAGE)!;
    expect(r.entries.every((e) => e.unread === null)).toBe(true);
    expect(selectConversationsToOpen(r.entries, 5).map((e) => e.ref)).toEqual(["1", "2", "3"]);
    expect(INBOX_RECENT_FALLBACK).toBe(3);
  });

  it("sélection : non lues seulement, plafonnées ; dates plus récentes d'abord quand le statut est inconnu", () => {
    const e = (ref: string, unread: boolean | null, lastMessageAt: string | null = null): InboxListEntry => ({ ref, unread, buyerHandle: null, itemExternalRef: null, lastMessageAt });
    expect(selectConversationsToOpen([e("1", true), e("2", false), e("3", true), e("4", true)], 2).map((x) => x.ref)).toEqual(["1", "3"]);
    expect(selectConversationsToOpen([e("1", false), e("2", false)], 5)).toEqual([]);
    expect(selectConversationsToOpen([e("1", null, "2026-11-01T00:00:00Z"), e("2", null, "2026-11-03T00:00:00Z"), e("3", null, "2026-11-02T00:00:00Z"), e("4", null, "2026-10-01T00:00:00Z")], 5).map((x) => x.ref)).toEqual(["2", "3", "1"]);
  });

  it("structure inconnue : aucun résultat, diagnostic fait de comptes et de noms de structure, sans aucun texte de la page", () => {
    const secret = "Message privé de Mme Testeuse au 06 00 00 00 00";
    const html = `<!doctype html><html><head><title>${secret}</title></head><body><div data-testid="thread-row-12345"><p>${secret}</p></div><div data-testid="thread-row-67890">acheteur_pseudo_test</div></body></html>`;
    expect(parseInboxDocumentLoose(parseHtmlDocument(html), PAGE)).toBeNull();
    const d = inboxPageDiagnostic(html, 2);
    expect(d).toMatchObject({ payloads: 2, inboxLinks: 0, inboxRefs: 0, testids: "thread-row-#:2" });
    const flat = JSON.stringify(d);
    expect(flat).not.toContain("Testeuse");
    expect(flat).not.toContain("acheteur_pseudo_test");
    expect(flat).not.toMatch(/12345|67890|06 00/);
  });
});
