import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { DemoConnector } from "./demo/simulator";
import { VintedExtensionConnector } from "./vinted/connector";
import { detectPage, parseConversationPage, parseItemPage, parsePriceCents } from "./vinted/adapters/v1";
import { HTML_MAX_DEPTH, HtmlSelectorError, parseHtmlDocument } from "./vinted/adapters/html";
import {
  CATALOG_ADAPTER_VERSION,
  buildSearchUrl,
  detectCatalogBlock,
  filterCatalogItems,
  parseAbsoluteTime,
  parseCatalogDocument,
  parseCatalogPage,
  parseRelativeTime,
} from "./vinted/adapters/v1-catalog";
import { CHECKOUT_SELECTORS, parseCheckoutDocument, parseCheckoutPage, readItemPurchaseState } from "./vinted/adapters/v1-checkout";
import { describeConnectors, getConnector } from "./registry";

const fixture = (name: string) => readFileSync(new URL(`./vinted/fixtures/${name}`, import.meta.url), "utf8");
function load(html: string) {
  const w = new Window();
  w.document.write(html);
  return w.document as unknown as Parameters<typeof parseItemPage>[0];
}
const ctx = { orgId: "org-1", connectionId: "c1", config: {}, now: new Date("2026-10-08T10:00:00Z") };

describe("DemoConnector", () => {
  it("envoie de façon simulée et idempotente, et sait refuser", async () => {
    const c = new DemoConnector();
    const a = await c.sendMessage(ctx, { conversationRef: "x", body: "Bonjour", idempotencyKey: "k1" });
    const b = await c.sendMessage(ctx, { conversationRef: "x", body: "Bonjour", idempotencyKey: "k1" });
    expect(a.ok && a.simulated).toBe(true);
    expect(a).toEqual(b);
    const fail = await c.sendMessage(ctx, { conversationRef: "x", body: "test [échec]", idempotencyKey: "k2" });
    expect(fail.ok).toBe(false);
  });
  it("décrit ses capacités comme simulées", async () => {
    const t = await new DemoConnector().test(ctx);
    expect(t.simulated).toBe(true);
    expect(t.status).toBe("connected");
  });
});

describe("VintedExtensionConnector", () => {
  it("n'envoie jamais côté serveur et reste expérimental", async () => {
    const c = new VintedExtensionConnector();
    expect(c.describe().experimental).toBe(true);
    const r = await c.sendMessage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("needs_browser");
  });
  it("calcule le statut depuis la dernière activité de l'extension", async () => {
    const c = new VintedExtensionConnector();
    expect((await c.test(ctx)).status).toBe("ready");
    expect((await c.test({ ...ctx, config: { extensionLastSeenAt: "2026-10-08T09:50:00Z" } })).status).toBe("connected");
    expect((await c.test({ ...ctx, config: { extensionLastSeenAt: "2026-10-08T07:00:00Z" } })).status).toBe("degraded");
    expect((await c.test({ ...ctx, config: { extensionLastSeenAt: "2026-10-01T07:00:00Z" } })).status).toBe("expired");
  });
});

describe("adaptateur DOM Vinted v1 (fixtures)", () => {
  it("détecte les pages prises en charge", () => {
    expect(detectPage("https://www.vinted.fr/items/123456-veste")).toBe("item");
    expect(detectPage("https://www.vinted.fr/inbox/987")).toBe("conversation");
    expect(detectPage("https://www.vinted.fr/catalog")).toBe("unknown");
    expect(detectPage("https://evil.example/items/1")).toBe("unknown");
    expect(detectPage("pas une url")).toBe("unknown");
  });
  it("parse une page article et nettoie le contenu non fiable", () => {
    const r = parseItemPage(load(fixture("item-page.v1.html")), "https://www.vinted.fr/items/123456-veste");
    expect(r.ok).toBe(true);
    expect(r.data?.title).toBe("Veste en jean Levi's Trucker");
    expect(r.data?.priceCents).toBe(3500);
    expect(r.data?.brand).toBe("Levi's");
    expect(r.data?.condition).toBe("very_good");
    expect(r.data?.externalRef).toBe("123456");
    expect(r.data?.photoUrls).toHaveLength(2);
    expect(r.data?.description).not.toMatch(/<b>/);
  });
  it("parse une conversation avec direction des messages et champ de réponse", () => {
    const r = parseConversationPage(load(fixture("conversation-page.v1.html")), "https://www.vinted.fr/inbox/987");
    expect(r.ok).toBe(true);
    expect(r.data?.buyerHandle).toBe("lea_m");
    expect(r.data?.messages.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
    expect(r.data?.composerFound).toBe(true);
    expect(r.data?.itemPriceCents).toBe(3500);
  });
  it("échoue proprement sur une structure inconnue", () => {
    const r = parseItemPage(load(fixture("unknown-page.html")), "https://www.vinted.fr/items/1");
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("title");
    expect(r.data).toBeNull();
  });
  it("parse les prix français", () => {
    expect(parsePriceCents("35,00 €")).toBe(3500);
    expect(parsePriceCents("1 250,5 €")).toBe(125050);
    expect(parsePriceCents("gratuit")).toBeNull();
  });
});

describe("registre", () => {
  it("expose les connecteurs et leurs capacités", () => {
    expect(describeConnectors().map((d) => d.provider).sort()).toEqual(["demo", "vinted"]);
    expect(getConnector("demo")).toBe(getConnector("demo"));
  });
});

describe("lecture d'une page HTML reçue en texte (sans navigateur)", () => {
  it("donne le même résultat que happy-dom pour les adaptateurs v1 (article, conversation)", () => {
    for (const [name, url] of [
      ["item-page.v1.html", "https://www.vinted.fr/items/123456-veste"],
      ["item-buy.v1.html", "https://www.vinted.fr/items/5012345601-veste"],
      ["unknown-page.html", "https://www.vinted.fr/items/1"],
    ] as const) {
      expect(parseItemPage(parseHtmlDocument(fixture(name)), url)).toEqual(parseItemPage(load(fixture(name)), url));
    }
    const conv = fixture("conversation-page.v1.html");
    expect(parseConversationPage(parseHtmlDocument(conv), "https://www.vinted.fr/inbox/987")).toEqual(parseConversationPage(load(conv), "https://www.vinted.fr/inbox/987"));
    expect(parseHtmlDocument(fixture("item-page.v1.html")).title).toBe(load(fixture("item-page.v1.html")).title);
  });

  it("sélecteurs pris en charge : type, id, classes, attributs, descendant, enfant, listes", () => {
    const doc = parseHtmlDocument(`<div id="a" class="x y"><p data-k="pre-mid-suf" title="un deux">1</p><section><p>2</p></section></div><p class="y">3</p>`);
    expect(doc.querySelectorAll("p").map((e) => e.textContent)).toEqual(["1", "2", "3"]);
    expect(doc.querySelectorAll("div > p").map((e) => e.textContent)).toEqual(["1"]);
    expect(doc.querySelectorAll("#a p").map((e) => e.textContent)).toEqual(["1", "2"]);
    expect(doc.querySelectorAll(".y").length).toBe(2);
    expect(doc.querySelectorAll("div.x.y").length).toBe(1);
    expect(doc.querySelector('[data-k^="pre"]')?.textContent).toBe("1");
    expect(doc.querySelector('[data-k$="suf"]')?.textContent).toBe("1");
    expect(doc.querySelector("[data-k*='mid']")?.textContent).toBe("1");
    expect(doc.querySelector("[title~=deux]")?.textContent).toBe("1");
    expect(doc.querySelector('[data-k="nope"]')).toBeNull();
    expect(doc.querySelectorAll("section p, .y").map((e) => e.textContent)).toEqual(["12", "2", "3"]);
    expect(() => doc.querySelector("p:first-child")).toThrow(HtmlSelectorError);
    expect(() => doc.querySelector("p + p")).toThrow(HtmlSelectorError);
  });

  it("tolérant : entités, balises non fermées, éléments vides, scripts et commentaires ignorés comme balisage", () => {
    const doc = parseHtmlDocument(`<!doctype html><title>A &amp; B</title><ul><li>un<li>deux &euro;<li>trois&nbsp;!</ul><img src="x.jpg"><br><p>a<p>b<script>var s = "<p>faux</p>";</script><!-- <p>commentaire</p> --></div></span>`);
    expect(doc.title).toBe("A & B");
    expect(doc.querySelectorAll("li").map((e) => e.textContent)).toEqual(["un", "deux €", "trois !"]);
    expect(doc.querySelectorAll("p").map((e) => e.textContent.replace(/var.*/, ""))).toEqual(["a", "b"]);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("x.jpg");
  });

  it("borné : profondeur limitée sans planter, entrée vide ou absurde", () => {
    const deep = parseHtmlDocument("<div>".repeat(HTML_MAX_DEPTH + 50) + "fin");
    expect(deep.truncated).toBe(true);
    expect(deep.querySelectorAll("div").length).toBe(HTML_MAX_DEPTH + 50);
    expect(parseHtmlDocument("").querySelector("div")).toBeNull();
    expect(parseHtmlDocument("<<<>>> < a <b").textContent).toContain("<");
  });
});

describe("adaptateur catalogue v1 (fixtures)", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  const html = fixture("catalog-page.v1.html");

  it("lit les 12 annonces de la page avec leurs champs", () => {
    const r = parseCatalogPage(html, { now });
    expect(r).toMatchObject({ adapterVersion: CATALOG_ADAPTER_VERSION, pageOk: true, blocked: null, skipped: 0, missing: [] });
    expect(r.items).toHaveLength(12);
    expect(new Set(r.items.map((i) => i.externalRef)).size).toBe(12);
    expect(r.items[0]).toEqual({
      externalRef: "5012345601",
      url: "https://www.vinted.fr/items/5012345601-veste-en-jean-levi-s-trucker",
      title: "Veste en jean Levi's Trucker",
      brand: "Levi's",
      size: "M / 38 / 10",
      condition: "very_good",
      priceCents: 1800,
      shippingCents: 288,
      sellerHandle: "vendeuse_demo_01",
      sellerRating: 4.9,
      sellerReviews: 212,
      photoCount: 6,
      photoUrl: "https://images.example.invalid/catalog/5012345601-1.jpg",
      publishedAt: now.toISOString(),
      publishedAtSource: "relative",
      observedAt: now.toISOString(),
    });
    for (const i of r.items) {
      expect(i.url).toMatch(/^https:\/\/www\.vinted\.fr\/items\/\d+-[a-z0-9-]+$/);
      expect(i.priceCents).toBeGreaterThan(0);
      expect(i.condition).not.toBeNull();
      expect(i.sellerHandle).toMatch(/demo/);
    }
    const byRef = new Map(r.items.map((i) => [i.externalRef, i]));
    expect(byRef.get("5012345606")).toMatchObject({ brand: "The North Face", size: "XL", condition: "satisfactory", priceCents: 9500 });
    expect(byRef.get("5012345607")).toMatchObject({ condition: "new_without_tags", photoCount: 2 });
    expect(byRef.get("5012345607")?.sellerRating).toBeUndefined();
    expect(byRef.get("5012345608")).toMatchObject({ photoCount: 1, priceCents: 600 });
    expect(byRef.get("5012345608")?.shippingCents).toBeUndefined();
    expect(byRef.get("5012345612")?.size).toBe("10 ans / 140 cm");
  });

  it("horodatages : absolu quand la page le donne, sinon estimé depuis « il y a … »", () => {
    const r = parseCatalogPage(html, { now });
    const at = (ref: string) => r.items.find((i) => i.externalRef === ref)!;
    expect(at("5012345603")).toMatchObject({ publishedAt: "2026-10-29T09:57:00.000Z", publishedAtSource: "absolute" });
    expect(at("5012345606")).toMatchObject({ publishedAt: "2026-10-29T09:48:00.000Z", publishedAtSource: "absolute" });
    expect(at("5012345602")).toMatchObject({ publishedAt: "2026-10-29T09:59:00.000Z", publishedAtSource: "relative" });
    expect(at("5012345604")).toMatchObject({ publishedAt: "2026-10-29T09:55:00.000Z", publishedAtSource: "relative" });
    expect(at("5012345609")).toMatchObject({ publishedAt: "2026-10-29T09:00:00.000Z", publishedAtSource: "relative" });
    expect(at("5012345610")).toMatchObject({ publishedAt: "2026-10-29T08:02:00.000Z", publishedAtSource: "absolute" });
    expect(at("5012345611").publishedAt).toBe("2026-10-29T07:00:00.000Z");
    expect(at("5012345612").publishedAt).toBe("2026-10-28T10:00:00.000Z");
    // Ordre « plus récentes d'abord » respecté par les dates lues ou estimées.
    const times = r.items.map((i) => Date.parse(i.publishedAt!));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("même résultat sur un vrai DOM (happy-dom) que sur la lecture du HTML", () => {
    const fromDom = parseCatalogDocument(load(html), { now });
    const { blocked: _blocked, ...fromHtml } = parseCatalogPage(html, { now });
    expect(fromDom).toEqual(fromHtml);
  });

  it("page de blocage : blocked, aucune annonce, pageOk faux", () => {
    const r = parseCatalogPage(fixture("catalog-blocked.v1.html"), { now });
    expect(r).toMatchObject({ pageOk: false, blocked: { code: "captcha" }, items: [] });
    // Statut 429 ou texte « trop de requêtes » : rate_limited ; 403 : blocked.
    const tooMany = `<html><head><title>Vinted</title></head><body><h1>Trop de requêtes</h1></body></html>`;
    expect(parseCatalogPage(tooMany, { now }).blocked).toMatchObject({ code: "rate_limited" });
    expect(parseCatalogPage(html, { now, status: 429 }).blocked).toMatchObject({ code: "rate_limited" });
    expect(parseCatalogPage(`<html><body><p>Erreur</p></body></html>`, { now, status: 403 }).blocked).toMatchObject({ code: "blocked" });
    expect(detectCatalogBlock(html, "https://geo.captcha-delivery.com/captcha/?x=1")).toMatchObject({ code: "captcha" });
    expect(detectCatalogBlock(html, "https://www.vinted.fr/catalog")).toBeNull();
  });

  it("détecteur injecté (Selio Cloud passe detectBlock de @selio/cloud)", () => {
    const calls: (number | null)[] = [];
    const r = parseCatalogPage(html, {
      now,
      status: 200,
      detectBlock: (_h, _u, o) => {
        calls.push(o.status);
        return { code: "warning", pattern: "test" };
      },
    });
    expect(calls).toEqual([200]);
    expect(r).toMatchObject({ pageOk: false, blocked: { code: "warning", pattern: "test" }, items: [] });
  });

  it("page inconnue ou structure changée : pageOk faux, rien n'est inventé", () => {
    const unknown = parseCatalogPage(fixture("unknown-page.html"), { now });
    expect(unknown).toMatchObject({ pageOk: false, blocked: null, items: [], missing: ["catalog-grid"] });
    expect(parseCatalogPage(fixture("item-page.v1.html"), { now }).pageOk).toBe(false);
    // Grille vide (aucun résultat) : page reconnue, zéro annonce.
    expect(parseCatalogPage(`<main><div data-testid="catalog-grid"></div></main>`, { now })).toMatchObject({ pageOk: true, items: [] });
    // Cartes présentes mais illisibles : la page a changé.
    expect(parseCatalogPage(`<div data-testid="catalog-grid"><div data-testid="grid-item"><span>?</span></div></div>`, { now })).toMatchObject({ pageOk: false, missing: ["items"] });
  });

  it("écarte les liens hors Vinted (liste fermée) et les doublons", () => {
    const tampered = html
      .replace("https://www.vinted.fr/items/5012345602-", "https://www.vinted.lol/items/5012345602-")
      .replace("https://www.vinted.fr/items/5012345604-", "http://www.vinted.fr/items/5012345604-")
      .replace(/(<div data-testid="grid-item"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/, "$1$1");
    const r = parseCatalogPage(tampered, { now });
    expect(r.items.map((i) => i.externalRef)).not.toContain("5012345602");
    expect(r.items.map((i) => i.externalRef)).not.toContain("5012345604");
    expect(r.items).toHaveLength(10);
    expect(r.skipped).toBe(3);
    // Lien relatif : résolu sur l'adresse de la page.
    const relative = html.replace("https://www.vinted.fr/items/5012345601-", "/items/5012345601-");
    expect(parseCatalogPage(relative, { now, url: "https://www.vinted.be/catalog?search_text=veste" }).items[0]?.url).toBe("https://www.vinted.be/items/5012345601-veste-en-jean-levi-s-trucker");
  });

  it("dates relatives et absolues", () => {
    expect(parseRelativeTime("il y a 3 min", now)?.toISOString()).toBe("2026-10-29T09:57:00.000Z");
    expect(parseRelativeTime("Ajouté il y a 12 minutes", now)?.toISOString()).toBe("2026-10-29T09:48:00.000Z");
    expect(parseRelativeTime("il y a une heure", now)?.toISOString()).toBe("2026-10-29T09:00:00.000Z");
    expect(parseRelativeTime("il y a 45 s", now)?.toISOString()).toBe("2026-10-29T09:59:15.000Z");
    expect(parseRelativeTime("À l'instant", now)?.toISOString()).toBe(now.toISOString());
    expect(parseRelativeTime("il y a 2 semaines", now)?.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(parseRelativeTime("5 minutes ago", now)?.toISOString()).toBe("2026-10-29T09:55:00.000Z");
    expect(parseRelativeTime("hier", now)).toBeNull();
    expect(parseRelativeTime("il y a 3 lunes", now)).toBeNull();
    expect(parseAbsoluteTime("2026-10-29T09:57:00+01:00")?.toISOString()).toBe("2026-10-29T08:57:00.000Z");
    expect(parseAbsoluteTime("1793260620")?.toISOString()).toBe(new Date(1793260620 * 1000).toISOString());
    // Sans fuseau : ambigu, refusé.
    expect(parseAbsoluteTime("2026-10-29T09:57:00")).toBeNull();
    expect(parseAbsoluteTime("demain")).toBeNull();
  });
});

describe("adresse de recherche catalogue", () => {
  it("search_text et prix seulement, tri des plus récentes, aucun identifiant Vinted inventé", () => {
    const url = new URL(buildSearchUrl({ keywords: ["veste", " jean "], brands: ["Levi's"], sizes: ["M"], conditions: ["very_good"], maxPriceCents: 2500 }));
    expect(url.origin).toBe("https://www.vinted.fr");
    expect(url.pathname).toBe("/catalog");
    expect(Object.fromEntries(url.searchParams)).toEqual({ search_text: "veste jean Levi's", price_to: "25", currency: "EUR", order: "newest_first" });
    expect(url.search).not.toMatch(/brand_ids|size_ids|status_ids|catalog%5B|catalog\[/);
    // Plusieurs marques : aucune dans le texte (filtrées après lecture).
    expect(new URL(buildSearchUrl({ keywords: ["sweat"], brands: ["Nike", "Adidas"], maxPriceCents: 1999 })).searchParams.get("search_text")).toBe("sweat");
    expect(new URL(buildSearchUrl({ maxPriceCents: 1999 })).searchParams.get("price_to")).toBe("19.99");
    expect(new URL(buildSearchUrl({})).searchParams.has("search_text")).toBe(false);
    expect(buildSearchUrl({ keywords: ["robe"] }, { host: "www.vinted.be" })).toMatch(/^https:\/\/www\.vinted\.be\/catalog\?/);
    expect(() => buildSearchUrl({}, { host: "www.vinted.lol" })).toThrow(/Domaine refusé/);
  });

  it("filtre local des critères qui ne passent pas dans l'adresse", () => {
    const items = parseCatalogPage(fixture("catalog-page.v1.html"), { now: new Date("2026-10-29T10:00:00Z") }).items;
    expect(filterCatalogItems(items, { brands: ["levis", "NIKE"] }).map((i) => i.brand)).toEqual(["Levi's", "Nike"]);
    expect(filterCatalogItems(items, { sizes: ["38"] }).map((i) => i.externalRef)).toEqual(["5012345601", "5012345611"]);
    expect(filterCatalogItems(items, { conditions: ["new_with_tags", "new_without_tags"] }).map((i) => i.externalRef)).toEqual(["5012345603", "5012345607"]);
    expect(filterCatalogItems(items, { maxPriceCents: 1200 }).map((i) => i.priceCents)).toEqual([600, 1100]);
    expect(filterCatalogItems(items, {})).toHaveLength(12);
  });
});

describe("adaptateur de paiement v1 (fixtures)", () => {
  const url = "https://www.vinted.fr/checkout?transaction_id=1";

  it("page de paiement : montants, porte-monnaie proposé, bouton de paiement", () => {
    const r = parseCheckoutPage(fixture("checkout-page.v1.html"), { url });
    expect(r).toMatchObject({ ok: true, kind: "checkout", missing: [] });
    expect(r.data).toEqual({
      kind: "checkout",
      itemPriceCents: 1800,
      shippingCents: 288,
      buyerProtectionCents: 160,
      totalCents: 2248,
      wallet: { offered: true, selected: false, balanceCents: 3520 },
      payButtonFound: true,
      orderRef: null,
    });
    const chosen = fixture("checkout-page.v1.html").replace('value="wallet">', 'value="wallet" checked>').replace('value="card" checked>', 'value="card">');
    expect(parseCheckoutPage(chosen, { url }).data.wallet).toEqual({ offered: true, selected: true, balanceCents: 3520 });
    expect(parseCheckoutDocument(load(fixture("checkout-page.v1.html")), url)).toEqual(r);
  });

  it("validation 3-D Secure demandée par la banque : reconnue (l'achat attend le client)", () => {
    const r = parseCheckoutPage(fixture("checkout-3ds.v1.html"), { url });
    expect(r).toMatchObject({ ok: true, kind: "three_ds" });
    expect(r.data.totalCents).toBe(2248);
  });

  it("confirmation : référence de commande et total payé ; refus de paiement ; page inconnue", () => {
    const done = parseCheckoutPage(fixture("checkout-done.v1.html"), { url: "https://www.vinted.fr/checkout/success" });
    expect(done).toMatchObject({ ok: true, kind: "confirmation", data: { orderRef: "7788990011", totalCents: 2248 } });
    const refused = fixture("checkout-page.v1.html").replace("<h1>Paiement</h1>", `<h1>Paiement</h1><div role="alert" data-testid="payment-error">Le paiement a été refusé par ta banque.</div>`);
    expect(parseCheckoutPage(refused, { url }).kind).toBe("payment_error");
    expect(parseCheckoutPage(fixture("unknown-page.html"), { url })).toMatchObject({ ok: false, kind: "unknown" });
    expect(parseCheckoutPage(fixture("checkout-page.v1.html").replace(/<div data-testid="checkout-total">.*<\/div>/, ""), { url })).toMatchObject({ ok: false, kind: "checkout", missing: ["total"] });
  });

  it("annonce : bouton « Acheter » trouvé, ou raison de son absence", () => {
    expect(readItemPurchaseState(parseHtmlDocument(fixture("item-buy.v1.html")))).toEqual({ buyButtonFound: true, unavailable: null });
    expect(readItemPurchaseState(load(fixture("item-page.v1.html")))).toEqual({ buyButtonFound: false, unavailable: null });
    const sold = fixture("item-buy.v1.html").replace(/<button type="button" data-testid="item-buy-button">Acheter<\/button>/, `<div data-testid="item-status--sold">Vendu</div>`);
    expect(readItemPurchaseState(parseHtmlDocument(sold))).toEqual({ buyButtonFound: false, unavailable: "sold" });
    // Repli par le nom visible quand le sélecteur a changé.
    const renamed = fixture("item-buy.v1.html").replace('data-testid="item-buy-button"', 'data-testid="cta-1"');
    expect(readItemPurchaseState(parseHtmlDocument(renamed)).buyButtonFound).toBe(true);
  });

  it("aucun sélecteur de champ de saisie bancaire (code, carte) : rien n'est jamais saisi à la place du client", () => {
    const all = Object.values(CHECKOUT_SELECTORS).flat().join(" ");
    expect(all).not.toMatch(/otp|cvc|cvv|card-number|cardnumber|password|sms|input\[type="(?:text|tel|number|password)"\]/i);
  });
});
