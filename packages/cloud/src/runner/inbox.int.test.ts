import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProfileDir } from "../profile";
import type { CloudLogger, StorageState } from "../types";
import { PlaywrightRunner } from "./playwright";

/**
 * Lecture de la messagerie avec un vrai Chromium, sur des pages LOCALES et SYNTHÉTIQUES (jamais vinted.*).
 * La messagerie locale charge elle-même ses données en JSON (comme on suppose que Vinted le fait) ; une
 * conversation n'existe qu'en HTML (repli sur l'adaptateur v1). Chaque page écoute les clics et le
 * signale au serveur : le test prouve qu'aucun clic ni aucune requête autre que GET n'a lieu.
 * Ignoré sans CLOUD_CHROMIUM_PATH.
 */
const chromiumPath = process.env.CLOUD_CHROMIUM_PATH;
const isRoot = process.getuid?.() === 0;

const conversationFixture = readFileSync(new URL("../../../connectors/src/vinted/fixtures/conversation-page.v1.html", import.meta.url), "utf8");

/** Mouchard : tout clic (ou envoi de formulaire) est signalé au serveur. */
const SPY = `<script>
document.addEventListener("click", function () { fetch("/espion/clic"); }, true);
document.addEventListener("submit", function () { fetch("/espion/envoi"); }, true);
</script>`;

const INBOX_PAGE = `<!doctype html><html lang="fr"><head><title>Messages</title></head><body><main><h1>Messages</h1><ul id="liste"></ul></main>
<script>
fetch("/api/v2/inbox?page=1&per_page=20").then(function (r) { return r.json(); }).then(function (d) {
  var ul = document.getElementById("liste");
  d.conversations.forEach(function (c) {
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = "/inbox/" + c.id;
    a.textContent = c.opposite_user.login;
    li.appendChild(a);
    ul.appendChild(li);
  });
});
</script>${SPY}</body></html>`;

const INBOX_JSON = JSON.stringify({
  conversations: [
    { id: 101, unread: true, updated_at: "2026-11-27T09:00:00Z", opposite_user: { id: 7001, login: "acheteuse_locale" } },
    { id: 102, unread: false, updated_at: "2026-11-27T08:00:00Z", opposite_user: { id: 7002, login: "deja_lu" } },
    { id: 103, unread: true, updated_at: "2026-11-27T07:00:00Z", opposite_user: { id: 7003, login: "lea_m" } },
  ],
});

const CONVERSATION_101_PAGE = `<!doctype html><html lang="fr"><head><title>Conversation</title></head><body><main id="fil"></main>
<script>
fetch("/api/v2/conversations/101").then(function (r) { return r.json(); }).then(function (d) {
  d.conversation.messages.forEach(function (m) {
    var p = document.createElement("p");
    p.className = "bulle";
    p.textContent = m.entity.body || "";
    document.getElementById("fil").appendChild(p);
  });
});
</script>${SPY}</body></html>`;

const CONVERSATION_101_JSON = JSON.stringify({
  conversation: {
    id: 101,
    opposite_user: { id: 7001, login: "acheteuse_locale" },
    transaction: { item_id: 4242 },
    messages: [
      { entity_type: "message", entity: { body: "Bonjour, le pull est dispo ?", user_id: 7001 }, created_at_ts: "2026-11-27T08:50:00Z" },
      { entity_type: "offer_request_message", entity: { body: "Je propose 20 €", user_id: 7001, price: { amount: "20.0", currency_code: "EUR" } }, created_at_ts: "2026-11-27T08:55:00Z" },
    ],
  },
});

const CAPTCHA_PAGE = `<!doctype html><html lang="fr"><head><title>Un instant…</title></head><body><div id="challenge-running"></div><h1>Vérifiez que vous êtes humain</h1></body></html>`;
const UNKNOWN_INBOX = `<!doctype html><html lang="fr"><head><title>Messages</title></head><body><div data-testid="thread-row-1">Texte privé de test</div>${SPY}</body></html>`;

const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok-test", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [],
};

describe.skipIf(!chromiumPath)("Lecture de la messagerie avec Chromium (pages locales synthétiques)", () => {
  let server: Server;
  let base = "";
  let mode: "normal" | "captcha_conversation" | "unknown" = "normal";
  const requests: { method: string; path: string }[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      requests.push({ method: req.method ?? "", path });
      const send = (body: string, type = "text/html; charset=utf-8", status = 200) => {
        res.writeHead(status, { "content-type": type });
        res.end(body);
      };
      if (path === "/inbox") return send(mode === "unknown" ? UNKNOWN_INBOX : INBOX_PAGE);
      if (path === "/api/v2/inbox") return send(INBOX_JSON, "application/json");
      if (path === "/inbox/101") return send(mode === "captcha_conversation" ? CAPTCHA_PAGE : CONVERSATION_101_PAGE, "text/html; charset=utf-8", mode === "captcha_conversation" ? 403 : 200);
      if (path === "/api/v2/conversations/101") return send(CONVERSATION_101_JSON, "application/json");
      if (path === "/inbox/103") return send(conversationFixture.replace("</body>", `${SPY}</body>`));
      if (path === "/inbox/102") return send(conversationFixture);
      if (path.startsWith("/espion/")) return send("ok", "text/plain");
      return send("<h1>Introuvable</h1>", "text/html; charset=utf-8", 404);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  beforeEach(() => {
    requests.length = 0;
    mode = "normal";
  });

  const logs: { level: string; message: string; data?: Record<string, unknown> }[] = [];
  const logger: CloudLogger = { info: (message, data) => logs.push({ level: "info", message, data }), warn: (message, data) => logs.push({ level: "warn", message, data }) };
  const runner = () => new PlaywrightRunner({ chromiumPath: chromiumPath!, baseUrl: base, actionTimeoutMs: 60_000, sandbox: !isRoot, logger });

  it("lit la liste (JSON chargé par la page), ouvre seulement les conversations non lues, sans aucun clic ni requête autre que GET", async () => {
    const profileDir = await createProfileDir();
    const out = await runner().run({ session, action: { kind: "sync_inbox", inboxUrl: `${base}/inbox`, maxConversations: 5 }, profileDir });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.inbox).toMatchObject({ listSource: "api", listed: 3 });
    const byRef = new Map(out.inbox!.conversations.map((c) => [c.ref, c]));
    expect([...byRef.keys()].sort()).toEqual(["101", "103"]);
    // 101 : messages lus dans le JSON de la conversation, offre en euros, article rattaché.
    expect(byRef.get("101")).toMatchObject({ buyerHandle: "acheteuse_locale", itemExternalRef: "4242" });
    expect(byRef.get("101")!.messages.map((m) => [m.direction, m.offerCents])).toEqual([["inbound", null], ["inbound", 2000]]);
    // 103 : pas de JSON, repli sur l'adaptateur v1 (HTML).
    expect(byRef.get("103")!.buyerHandle).toBe("lea_m");
    expect(byRef.get("103")!.messages.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
    // Conversation déjà lue : jamais ouverte.
    expect(requests.some((r) => r.path === "/inbox/102")).toBe(false);
    // Aucun clic, aucun envoi, aucune requête qui modifie quoi que ce soit.
    expect(requests.filter((r) => r.path.startsWith("/espion/"))).toEqual([]);
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    await expect(stat(profileDir)).rejects.toThrow();
    // Journal : des comptes, jamais un texte ni un pseudo.
    const flat = JSON.stringify(logs);
    expect(flat).not.toMatch(/acheteuse_locale|lea_m|pull est dispo|20 €/);
  });

  it("CAPTCHA sur une conversation : arrêt immédiat avec le code (pause du compte), rien n'a été fait", async () => {
    mode = "captcha_conversation";
    const out = await runner().run({ session, action: { kind: "sync_inbox", inboxUrl: `${base}/inbox` }, profileDir: await createProfileDir() });
    expect(out).toMatchObject({ ok: false, code: "captcha", sideEffects: "none" });
    // Arrêt au premier signal : la conversation suivante n'est pas ouverte.
    expect(requests.some((r) => r.path === "/inbox/103")).toBe(false);
  });

  it("messagerie non reconnue : succès sans conversation, diagnostic de structure journalisé sans texte de la page", async () => {
    mode = "unknown";
    logs.length = 0;
    const out = await runner().run({ session, action: { kind: "sync_inbox", inboxUrl: `${base}/inbox` }, profileDir: await createProfileDir() });
    expect(out).toMatchObject({ ok: true, inbox: { conversations: [], listSource: "none" } });
    const diag = logs.find((l) => l.message === "cloud.inbox.unrecognised");
    expect(diag?.data).toMatchObject({ inboxLinks: 0, testids: "thread-row-#:1" });
    expect(JSON.stringify(logs)).not.toContain("Texte privé");
  });
});
