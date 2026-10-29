import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfileDir, removeProfileDir } from "../profile";
import type { RunInput, StorageState } from "../types";
import { FakeRunner, fakeOutcome, type FakeLoginWindow } from "./fake";
import { PlaywrightRunner, blockAfterError, countSentCopies, type BlockCheckPage } from "./playwright";

const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [],
};
const reply = (conversationUrl = "https://www.vinted.fr/inbox/987"): RunInput["action"] => ({ kind: "reply", conversationUrl, text: "Bonjour, oui il est disponible." });

describe("FakeRunner", () => {
  it("joue les scénarios dans l'ordre puis le scénario par défaut", async () => {
    const runner = new FakeRunner({ scenarios: ["captcha", "not_logged_in", "timeout"] });
    const input: RunInput = { session, action: reply(), profileDir: "/tmp/x" };
    expect(await runner.run(input)).toMatchObject({ ok: false, code: "captcha", sideEffects: "none" });
    expect(await runner.run(input)).toMatchObject({ ok: false, code: "not_logged_in" });
    expect(await runner.run(input)).toMatchObject({ ok: false, code: "timeout", sideEffects: "unknown" });
    expect(await runner.run({ ...input, session: null })).toMatchObject({ ok: true, session: { cookies: [], origins: [] } });
    expect(runner.calls.map((c) => c.hadSession)).toEqual([true, true, true, false]);
  });

  it("accepte une issue complète ou une fonction, et filtre la session rendue", async () => {
    const runner = new FakeRunner().enqueue({ ok: false, code: "warning", message: "x" }, (i) => fakeOutcome(i.action.kind === "reply" ? "ok" : "error", i));
    const mixed = { cookies: [...session.cookies, { ...session.cookies[0]!, domain: ".google.com" }], origins: [] };
    expect(await runner.run({ session, action: reply(), profileDir: "/tmp/x" })).toMatchObject({ code: "warning" });
    const ok = await runner.run({ session: mixed, action: reply(), profileDir: "/tmp/x" });
    expect(ok.ok && ok.session.cookies.map((c) => c.domain)).toEqual([".vinted.fr"]);
  });

  it("fenêtre de connexion factice : entrées comptées, session filtrée, fermeture prévenue", async () => {
    const runner = new FakeRunner({ loginState: { cookies: [...session.cookies, { ...session.cookies[0]!, domain: "localhost" }], origins: [] } });
    const win = (await runner.openLoginWindow({ profileDir: "/tmp/x" })) as FakeLoginWindow;
    const frames: number[] = [];
    win.onFrame((f) => frames.push(f.width));
    win.emitFrame();
    await win.dispatchInput({ type: "text", text: "secret" });
    await expect(win.dispatchInput({ type: "nope" })).rejects.toThrow();
    expect(win.inputCount).toBe(1);
    expect(await win.isLoggedIn()).toBe(false);
    win.setLoggedIn(true);
    expect(await win.isLoggedIn()).toBe(true);
    const closed: string[] = [];
    win.onClose((s) => closed.push(s));
    expect(await win.blockSignal()).toBeNull();
    win.setSignal({ code: "captcha", pattern: "test" });
    expect(await win.blockSignal()).toEqual({ code: "captcha", pattern: "test" });
    const state = await win.finish();
    expect(state.cookies).toHaveLength(1);
    expect(closed).toEqual(["finished"]);
    expect(frames).toEqual([1280]);
    expect(await win.blockSignal()).toBeNull();
  });

  it("scénario « unavailable » : rien n'est lancé", async () => {
    const runner = new FakeRunner({ scenarios: ["unavailable"] });
    expect(await runner.run({ session, action: reply(), profileDir: "/tmp/x" })).toMatchObject({ ok: false, code: "unavailable", launched: false, sideEffects: "none" });
  });
});

describe("PlaywrightRunner — arrêts avant tout navigateur", () => {
  const dirs: string[] = [];
  // Playwright crée son dossier de profil par défaut sous TMPDIR, même quand l'exécutable manque :
  // il reste sous un dossier du test, supprimé à la fin.
  const savedTmp = process.env.TMPDIR;
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "selio-cloud-test-tmp-"));
    dirs.push(root);
    process.env.TMPDIR = root;
  });
  afterAll(async () => {
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
    for (const d of dirs) await removeProfileDir(d);
  });
  // Chemin inexistant : ces cas doivent s'arrêter avant de lancer Chromium.
  const runner = new PlaywrightRunner({ chromiumPath: "/nonexistent/chromium" });
  const profile = async () => {
    const d = await mkdtemp(join(tmpdir(), "selio-cloud-test-"));
    dirs.push(d);
    return d;
  };

  it("exige un chemin de Chromium (aucun téléchargement)", () => {
    expect(() => new PlaywrightRunner({ chromiumPath: "" })).toThrow(/CLOUD_CHROMIUM_PATH/);
  });

  it("n'accepte que des conversations ou articles Vinted (ou l'origine de test injectée)", () => {
    expect(runner.resolveTarget(reply("https://www.vinted.fr/inbox/987"))?.href).toBe("https://www.vinted.fr/inbox/987");
    expect(runner.resolveTarget(reply("/inbox/42"))?.href).toBe("https://www.vinted.fr/inbox/42");
    expect(runner.resolveTarget(reply("https://www.vinted.be/inbox/1"))).not.toBeNull();
    expect(runner.resolveTarget(reply("http://www.vinted.fr/inbox/1"))).toBeNull();
    expect(runner.resolveTarget(reply("https://evil.example/inbox/1"))).toBeNull();
    expect(runner.resolveTarget(reply("https://www.vinted.fr/items/1"))).toBeNull();
    expect(runner.resolveTarget({ kind: "republish", itemUrl: "https://www.vinted.fr/items/123-veste" })).not.toBeNull();
    const local = new PlaywrightRunner({ chromiumPath: "/x", baseUrl: "http://127.0.0.1:4000" });
    expect(local.resolveTarget(reply("http://127.0.0.1:4000/inbox/987"))).not.toBeNull();
    expect(local.resolveTarget(reply("http://127.0.0.1:4001/inbox/987"))).toBeNull();
  });

  it("refuse une action invalide, lourde (CLOUD_HEAVY_ACTIONS=false) ou hors Vinted, sans rien lancer", async () => {
    expect(await runner.run({ session, action: { kind: "reply", conversationUrl: "x", text: "" } as never, profileDir: await profile() })).toMatchObject({ ok: false, code: "error", sideEffects: "none", launched: false });
    expect(await runner.run({ session, action: { kind: "republish", itemUrl: "https://www.vinted.fr/items/1" }, profileDir: await profile() })).toMatchObject({ ok: false, code: "error", message: expect.stringMatching(/lourde/), launched: false });
    expect(await runner.run({ session, action: reply("https://evil.example/inbox/1"), profileDir: await profile() })).toMatchObject({ ok: false, code: "error", launched: false });
    // Domaine qui ressemble à Vinted sans lui appartenir (liste fermée).
    expect(await runner.run({ session, action: reply("https://www.vinted.lol/inbox/1"), profileDir: await profile() })).toMatchObject({ ok: false, code: "error", launched: false });
  });

  it("sans session enregistrée : not_logged_in, rien n'est lancé, dossier vide retiré", async () => {
    const dir = await profile();
    expect(await runner.run({ session: null, action: reply(), profileDir: dir })).toMatchObject({ ok: false, code: "not_logged_in" });
    await expect(readdir(dir)).rejects.toThrow();
    const onlyGoogle = { cookies: [{ ...session.cookies[0]!, domain: ".google.com" }], origins: [] };
    expect(await runner.run({ session: onlyGoogle, action: reply(), profileDir: await profile() })).toMatchObject({ code: "not_logged_in" });
  });

  it("refuse un dossier de travail non vide et ne le supprime pas", async () => {
    const dir = await profile();
    await writeFile(join(dir, "donnees.txt"), "x");
    const r = await runner.run({ session, action: reply(), profileDir: dir });
    expect(r).toMatchObject({ ok: false, code: "unavailable", launched: false, message: expect.stringMatching(/pas vide/) });
    expect(await readdir(dir)).toEqual(["donnees.txt"]);
  });

  it("navigateur introuvable : « unavailable » (rien n'a touché Vinted, tâche à remettre en file) et dossier supprimé", async () => {
    const dir = await profile();
    const r = await runner.run({ session, action: reply(), profileDir: dir });
    expect(r).toMatchObject({ ok: false, code: "unavailable", sideEffects: "none", launched: false });
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("aucun créneau libre : « unavailable » sans lancer de navigateur", async () => {
    const busy = new PlaywrightRunner({ chromiumPath: "/nonexistent/chromium", maxBrowsers: 1, slotWaitMs: 50 });
    const hold = await busy.slots.acquire();
    try {
      const dir = await profile();
      expect(await busy.run({ session, action: reply(), profileDir: dir })).toMatchObject({ ok: false, code: "unavailable", launched: false });
      await expect(readdir(dir)).rejects.toThrow();
    } finally {
      hold();
    }
  });
});

/**
 * Ce que Playwright passe RÉELLEMENT à Chromium : un faux exécutable (script shell) écrit ses
 * arguments et son environnement, puis s'arrête. Aucun navigateur n'est nécessaire.
 */
describe.skipIf(process.platform !== "linux")("PlaywrightRunner — arguments et environnement réellement transmis", () => {
  const roots: string[] = [];
  afterAll(async () => {
    for (const d of roots) await removeProfileDir(d);
  });

  async function capture(sandbox: boolean) {
    const root = await mkdtemp(join(tmpdir(), "selio-cloud-capture-"));
    roots.push(root);
    const fake = join(root, "chrome");
    await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${root}/args.txt'\nenv > '${root}/env.txt'\nexit 1\n`);
    await chmod(fake, 0o755);
    // TMPDIR : le dossier de profil par défaut que Playwright crée lui-même reste sous `root` (supprimé après le test).
    const saved = { SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY, DATABASE_URL: process.env.DATABASE_URL, REVOLUT_SECRET_KEY: process.env.REVOLUT_SECRET_KEY, TMPDIR: process.env.TMPDIR };
    process.env.TMPDIR = root;
    process.env.SECRETS_ENCRYPTION_KEY = "cle-de-test-ne-doit-pas-sortir";
    process.env.DATABASE_URL = "postgres://selio:motdepasse@127.0.0.1/selio";
    process.env.REVOLUT_SECRET_KEY = "sk_test_ne_doit_pas_sortir";
    const workDir = await createProfileDir(root);
    try {
      const r = await new PlaywrightRunner({ chromiumPath: fake, sandbox }).run({ session, action: reply(), profileDir: workDir });
      expect(r).toMatchObject({ ok: false, code: "unavailable", launched: false });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    const args = (await readFile(join(root, "args.txt"), "utf8")).split("\n").filter(Boolean);
    const env = await readFile(join(root, "env.txt"), "utf8");
    await expect(readdir(workDir)).rejects.toThrow();
    return { args, env, workDir };
  }

  it("bac à sable actif : jamais --no-sandbox, aucune variable secrète du worker", async () => {
    const { args, env, workDir } = await capture(true);
    expect(args).toContain("--disable-dev-shm-usage");
    expect(args).not.toContain("--no-sandbox");
    for (const a of args) expect(a).not.toMatch(/AutomationControlled|user-agent|stealth|fingerprint/i);
    expect(env).not.toMatch(/SECRETS_ENCRYPTION_KEY|DATABASE_URL|REVOLUT|cle-de-test|motdepasse|sk_test/);
    expect(env.split("\n")).toContain(`HOME=${workDir}`);
    expect(env).toMatch(/^TMPDIR=/m);
  });

  it("bac à sable désactivé seulement sur demande explicite (développement) : --no-sandbox apparaît", async () => {
    const { args, env } = await capture(false);
    expect(args).toContain("--no-sandbox");
    expect(env).not.toMatch(/SECRETS_ENCRYPTION_KEY|cle-de-test/);
  });
});

describe("blockAfterError", () => {
  const page = (contents: (string | Error)[], url = "https://www.vinted.fr/inbox/1"): BlockCheckPage => ({
    waitForLoadState: async () => {},
    content: async () => {
      const next = contents.shift() ?? "";
      if (next instanceof Error) throw next;
      return next;
    },
    url: () => url,
  });

  it("relit la page après une exception : un CAPTCHA est rendu comme tel (pause), pas comme une erreur", async () => {
    const captcha = `<html><head><title>Un instant</title></head><body><div role="dialog">Vérification de sécurité</div></body></html>`;
    expect(await blockAfterError(page([new Error("Execution context was destroyed"), captcha]), 10)).toMatchObject({ code: "captcha" });
    expect(await blockAfterError(page(["<html><body>ok</body></html>"], "https://www.vinted.fr/member/login"), 10)).toMatchObject({ code: "not_logged_in" });
  });

  it("page ordinaire ou illisible : aucun signal", async () => {
    expect(await blockAfterError(page(["<html><head><title>Conversation</title></head><body><textarea></textarea></body></html>"]), 10)).toBeNull();
    expect(await blockAfterError(page([new Error("x"), new Error("y")]), 10)).toBeNull();
  });
});

describe("countSentCopies", () => {
  it("compte les messages sortants identiques au texte (espaces réduits)", () => {
    const conv = {
      externalRef: "1",
      url: "u",
      buyerHandle: "b",
      itemTitle: null,
      itemPriceCents: null,
      composerFound: true,
      messages: [
        { direction: "outbound" as const, body: "Bonjour,  oui", at: null },
        { direction: "inbound" as const, body: "Bonjour, oui", at: null },
        { direction: "outbound" as const, body: "Autre", at: null },
      ],
    };
    expect(countSentCopies(conv, "Bonjour,\noui")).toBe(1);
    expect(countSentCopies(null, "x")).toBe(0);
  });
});
