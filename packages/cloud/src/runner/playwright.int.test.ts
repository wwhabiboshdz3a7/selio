import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfileDir } from "../profile";
import type { StorageState } from "../types";
import { PlaywrightRunner } from "./playwright";
import { probeChromium } from "./probe";

/**
 * Test d'intégration avec un vrai Chromium, sur un serveur HTTP local qui sert
 * la fixture de conversation de l'adaptateur Vinted v1. Jamais contre vinted.fr.
 * Ignoré sans CLOUD_CHROMIUM_PATH (ex. CLOUD_CHROMIUM_PATH=/opt/pw-browsers/chromium).
 *
 * Bac à sable actif, sauf en root (conteneur de développement) où Chromium ne
 * peut pas l'utiliser : c'est alors une exception de test, refusée en production.
 */
const chromiumPath = process.env.CLOUD_CHROMIUM_PATH;
const isRoot = process.getuid?.() === 0;

const fixture = readFileSync(new URL("../../../connectors/src/vinted/fixtures/conversation-page.v1.html", import.meta.url), "utf8");

/** La page « répond » à l'envoi en affichant le message, comme le ferait Vinted. */
const SEND_SCRIPT = `<script>
document.querySelector("form").addEventListener("submit", function (e) {
  e.preventDefault();
  var ta = document.querySelector("textarea");
  var text = ta.value.trim();
  if (!text) return;
  setTimeout(function () {
    var id = "message-own-" + Date.now();
    var li = document.createElement("li");
    li.setAttribute("data-testid", id);
    li.setAttribute("data-direction", "outbound");
    var p = document.createElement("p");
    p.setAttribute("data-testid", id + "-body");
    p.textContent = text;
    li.appendChild(p);
    document.querySelector("ul").appendChild(li);
    ta.value = "";
  }, 300);
});
document.cookie = "local_tracker=1; path=/";
try { localStorage.setItem("local_key", "local_value"); } catch (e) {}
</script>`;
const SILENT_SCRIPT = `<script>document.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); });</script>`;
/**
 * Après la saisie, un voile sans texte recouvre la page (le clic ne passe plus), puis Vinted y
 * affiche une vérification : l'exception du clic doit être relue comme un CAPTCHA, pas une erreur.
 */
const OVERLAY_SCRIPT = `<script>
document.querySelector("textarea").addEventListener("input", function () {
  if (document.getElementById("voile")) return;
  var v = document.createElement("div");
  v.id = "voile";
  v.setAttribute("style", "position:fixed;inset:0;z-index:9999;background:rgba(255,255,255,0.01)");
  document.body.appendChild(v);
  setTimeout(function () { v.setAttribute("role", "dialog"); v.textContent = "Vérification de sécurité en cours"; }, 800);
});
</script>`;

const CAPTCHA_PAGE = `<!doctype html><html lang="fr"><head><title>Un instant…</title></head><body><div id="challenge-running"></div><h1>Vérifiez que vous êtes humain</h1></body></html>`;

const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok-test", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [{ origin: "https://www.vinted.fr", localStorage: [{ name: "consent", value: "1" }] }],
};

describe.skipIf(!chromiumPath)("PlaywrightRunner avec Chromium (page locale)", () => {
  let server: Server;
  let base = "";
  const requests: { url: string; userAgent: string; cookie: string }[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      requests.push({ url: req.url ?? "", userAgent: req.headers["user-agent"] ?? "", cookie: req.headers.cookie ?? "" });
      const path = (req.url ?? "/").split("?")[0];
      const html = (body: string, status = 200) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      };
      if (path === "/inbox/987") return html(fixture.replace("</body>", `${SEND_SCRIPT}</body>`));
      if (path === "/inbox/555") return html(fixture.replace("</body>", `${SILENT_SCRIPT}</body>`));
      if (path === "/inbox/777") return html(fixture.replace("</body>", `${OVERLAY_SCRIPT}</body>`));
      if (path === "/inbox/666") return html(CAPTCHA_PAGE, 403);
      if (path === "/inbox/444") {
        res.writeHead(302, { location: "/member/login?ref=%2Finbox%2F444" });
        return res.end();
      }
      if (path === "/member/login") return html(`<!doctype html><html><head><title>Vinted</title></head><body><h1>Connecte-toi</h1><form><input type="email"><input type="password"></form></body></html>`);
      return html("<h1>Introuvable</h1>", 404);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const runner = (extra: { stepTimeoutMs?: number } = {}) => new PlaywrightRunner({ chromiumPath: chromiumPath!, baseUrl: base, actionTimeoutMs: 45_000, confirmTimeoutMs: 3_000, sandbox: !isRoot, ...extra });

  it("envoie la réponse, vérifie qu'elle apparaît, rend une session filtrée et supprime le profil", async () => {
    const profileDir = await createProfileDir();
    const text = "Bonjour, oui la veste est toujours disponible.";
    const out = await runner().run({ session, action: { kind: "reply", conversationUrl: `${base}/inbox/987`, text }, profileDir });
    expect(out).toMatchObject({ ok: true, detail: expect.stringMatching(/envoyé/) });
    if (!out.ok) throw new Error(out.message);
    // Seule la session vinted.* revient : ni le cookie ni le stockage local de 127.0.0.1.
    expect(out.session.cookies.map((c) => `${c.domain}:${c.name}`)).toEqual([".vinted.fr:access_token_web"]);
    expect(out.session.origins).toEqual([]);
    expect(JSON.stringify(out.session)).not.toMatch(/local_tracker|local_value|127\.0\.0\.1/);
    // Profil temporaire supprimé.
    await expect(stat(profileDir)).rejects.toThrow();
    // Aucun User-Agent falsifié : Chromium sans tête se présente comme tel.
    const hit = requests.find((r) => r.url.startsWith("/inbox/987"));
    expect(hit?.userAgent).toMatch(/HeadlessChrome/);
    // Les cookies Vinted ne partent jamais vers un autre domaine.
    expect(hit?.cookie ?? "").not.toContain("tok-test");
  });

  it("page de vérification anti-robot : code captcha, rien n'est saisi ni envoyé", async () => {
    const profileDir = await createProfileDir();
    const out = await runner().run({ session, action: { kind: "follow_up", conversationUrl: `${base}/inbox/666`, text: "Toujours intéressé ?" }, profileDir });
    expect(out).toMatchObject({ ok: false, code: "captcha", sideEffects: "none" });
    await expect(stat(profileDir)).rejects.toThrow();
  });

  it("redirection vers la page de connexion : not_logged_in", async () => {
    const out = await runner().run({ session, action: { kind: "reply", conversationUrl: `${base}/inbox/444`, text: "Bonjour" }, profileDir: await createProfileDir() });
    expect(out).toMatchObject({ ok: false, code: "not_logged_in", sideEffects: "none" });
  });

  it("CAPTCHA affiché par-dessus le bouton pendant l'action : relu après l'exception, code captcha (pause), pas « erreur »", async () => {
    const profileDir = await createProfileDir();
    const out = await runner({ stepTimeoutMs: 3_000 }).run({ session, action: { kind: "reply", conversationUrl: `${base}/inbox/777`, text: "Bonjour" }, profileDir });
    expect(out).toMatchObject({ ok: false, code: "captcha" });
    await expect(stat(profileDir)).rejects.toThrow();
  });

  it("vérification de démarrage : bac à sable refusé en root, accepté sinon ; Chromium sans bac à sable seulement sur demande", async () => {
    const withSandbox = await probeChromium({ chromiumPath: chromiumPath!, sandbox: true });
    if (isRoot) expect(withSandbox).toMatchObject({ ok: false, reason: "sandbox" });
    else expect(withSandbox).toMatchObject({ ok: true, sandbox: true });
    expect(await probeChromium({ chromiumPath: chromiumPath!, sandbox: false })).toMatchObject({ ok: true, sandbox: false });
    // Exécutable absent : Playwright crée son dossier de profil avant d'échouer ; il reste sous un dossier du test.
    const savedTmp = process.env.TMPDIR;
    const tmpRoot = await mkdtemp(join(tmpdir(), "selio-cloud-probe-"));
    process.env.TMPDIR = tmpRoot;
    try {
      expect(await probeChromium({ chromiumPath: "/nonexistent/chrome", sandbox: true })).toMatchObject({ ok: false, reason: "launch" });
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("message jamais affiché après le clic : timeout, effets « inconnus » (pas de renvoi automatique)", async () => {
    const out = await runner().run({ session, action: { kind: "reply", conversationUrl: `${base}/inbox/555`, text: "Bonjour" }, profileDir: await createProfileDir() });
    expect(out).toMatchObject({ ok: false, code: "timeout", sideEffects: "unknown" });
  });
});
