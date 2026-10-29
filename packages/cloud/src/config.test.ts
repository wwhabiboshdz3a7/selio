import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CLOUD_DEFAULTS, isActionAllowed, loadCloudConfig } from "./config";
import { PROFILE_PREFIX, ProfileDirError, createProfileDir, prepareProfileDir, removeProfileDir, sweepStaleProfiles } from "./profile";
import { CHROMIUM_ARGS, chromiumEnv, contextOptions, launchOptions } from "./runner/launch";
import { BrowserSlotTimeoutError, BrowserSlots } from "./slots";
import { ACTION_LEVELS, PAUSE_CODES, actionLevel, cloudActionSchema, isPauseCode } from "./types";

describe("types", () => {
  it("répondre et relancer sont légères, republier est lourde", () => {
    expect(ACTION_LEVELS).toEqual({ reply: "light", follow_up: "light", republish: "heavy" });
    expect(actionLevel("republish")).toBe("heavy");
  });

  it("CAPTCHA, avertissement, blocage et trop de requêtes mettent en pause — jamais de nouvelle tentative", () => {
    expect([...PAUSE_CODES].sort()).toEqual(["blocked", "captcha", "rate_limited", "warning"]);
    expect(isPauseCode("not_logged_in")).toBe(false);
    expect(isPauseCode("timeout")).toBe(false);
  });

  it("valide une action venue d'une file (donnée non fiable)", () => {
    expect(cloudActionSchema.safeParse({ kind: "reply", conversationUrl: "https://www.vinted.fr/inbox/1", text: "Bonjour" }).success).toBe(true);
    expect(cloudActionSchema.safeParse({ kind: "reply", conversationUrl: "https://www.vinted.fr/inbox/1", text: "   " }).success).toBe(false);
    expect(cloudActionSchema.safeParse({ kind: "reply", conversationUrl: "https://www.vinted.fr/inbox/1", text: "x".repeat(2001) }).success).toBe(false);
    expect(cloudActionSchema.safeParse({ kind: "delete_account" }).success).toBe(false);
  });
});

describe("loadCloudConfig", () => {
  it("défauts prudents : 5 navigateurs, actions lourdes fermées, 10 comptes, 5 min de connexion", () => {
    expect(loadCloudConfig({})).toEqual({ chromiumPath: null, ...CLOUD_DEFAULTS });
    expect(CLOUD_DEFAULTS).toMatchObject({ maxBrowsers: 5, heavyActions: false, maxAccountsPerOrg: 10, loginTimeoutMs: 300_000 });
  });

  it("lit et borne les variables", () => {
    const c = loadCloudConfig({
      CLOUD_CHROMIUM_PATH: " /opt/chromium ",
      CLOUD_HEADLESS: "false",
      CLOUD_ACTION_TIMEOUT_MS: "5",
      CLOUD_LOGIN_TIMEOUT_MS: "abc",
      CLOUD_MAX_BROWSERS: "50",
      CLOUD_HEAVY_ACTIONS: "true",
      CLOUD_MAX_ACCOUNTS_PER_ORG: "3",
    });
    expect(c).toEqual({ chromiumPath: "/opt/chromium", headless: false, actionTimeoutMs: 10_000, loginTimeoutMs: 300_000, maxBrowsers: 50, heavyActions: true, maxAccountsPerOrg: 3 });
  });

  it("adresse partagée : seules les actions légères passent sans CLOUD_HEAVY_ACTIONS", () => {
    expect(isActionAllowed("reply", { heavyActions: false })).toBe(true);
    expect(isActionAllowed("follow_up", { heavyActions: false })).toBe(true);
    expect(isActionAllowed("republish", { heavyActions: false })).toBe(false);
    expect(isActionAllowed("republish", { heavyActions: true })).toBe(true);
  });
});

describe("options de lancement", () => {
  it("aucune option de furtivité, ni User-Agent, ni arguments par défaut retirés ; bac à sable actif", () => {
    const o = launchOptions({ chromiumPath: "/opt/chromium", headless: true, timeoutMs: 30_000, sandbox: true, workDir: "/run/selio-cloud/selio-cloud-x", sourceEnv: {} });
    expect(o).toMatchObject({ executablePath: "/opt/chromium", headless: true, chromiumSandbox: true, artifactsDir: "/run/selio-cloud/selio-cloud-x/artifacts" });
    expect(o).not.toHaveProperty("userAgent");
    expect(o).not.toHaveProperty("ignoreDefaultArgs");
    expect(o).not.toHaveProperty("ignoreAllDefaultArgs");
    expect(o.args).toEqual([...CHROMIUM_ARGS]);
    expect(o.args).not.toContain("--no-sandbox");
    for (const a of o.args) expect(a).not.toMatch(/AutomationControlled|user-agent|stealth|fingerprint|webdriver|no-sandbox/i);
    const c = contextOptions({ width: 1280, height: 800 });
    expect(c).toEqual({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 800 }, acceptDownloads: false });
  });

  it("environnement de Chromium en liste blanche : aucune variable du worker, dossiers personnels temporaires", () => {
    const env = chromiumEnv("/run/selio-cloud/w", {
      PATH: "/usr/bin",
      LANG: "fr_FR.UTF-8",
      TZ: "Europe/Paris",
      HOME: "/home/selio",
      SECRETS_ENCRYPTION_KEY: "cle",
      DATABASE_URL: "postgres://x",
      REDIS_URL: "redis://x",
      REVOLUT_SECRET_KEY: "sk",
      SMTP_URL: "smtp://u:p@x",
      LD_PRELOAD: "/tmp/x.so",
      NODE_OPTIONS: "--inspect",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      LANG: "fr_FR.UTF-8",
      TZ: "Europe/Paris",
      HOME: "/run/selio-cloud/w",
      TMPDIR: "/run/selio-cloud/w",
      XDG_CONFIG_HOME: "/run/selio-cloud/w/.config",
      XDG_CACHE_HOME: "/run/selio-cloud/w/.cache",
      XDG_DATA_HOME: "/run/selio-cloud/w/.local/share",
    });
    expect(chromiumEnv("/w", {}).PATH).toBe("/usr/local/bin:/usr/bin:/bin");
  });
});

describe("BrowserSlots", () => {
  it("limite les navigateurs simultanés et sert les demandes dans l'ordre", async () => {
    const slots = new BrowserSlots(2);
    const r1 = await slots.acquire();
    const r2 = await slots.acquire();
    expect(slots.inUse).toBe(2);
    const order: number[] = [];
    const p3 = slots.acquire().then((r) => (order.push(3), r));
    const p4 = slots.acquire().then((r) => (order.push(4), r));
    expect(slots.waiting).toBe(2);
    r1();
    r1(); // idempotent
    const r3 = await p3;
    expect(order).toEqual([3]);
    r2();
    const r4 = await p4;
    expect(order).toEqual([3, 4]);
    r3();
    r4();
    expect(slots.inUse).toBe(0);
  });

  it("une attente est bornée", async () => {
    vi.useFakeTimers();
    try {
      const slots = new BrowserSlots(1);
      await slots.acquire();
      const p = slots.acquire(1_000);
      const check = expect(p).rejects.toBeInstanceOf(BrowserSlotTimeoutError);
      await vi.advanceTimersByTimeAsync(1_000);
      await check;
      expect(slots.waiting).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dossiers de profil", () => {
  const roots: string[] = [];
  afterAll(async () => {
    for (const r of roots) await removeProfileDir(r);
  });

  it("crée un dossier neuf et privé, le supprime à la fin", async () => {
    const base = await mkdtemp(join(tmpdir(), "selio-cloud-test-"));
    roots.push(base);
    const dir = await createProfileDir(base);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    await prepareProfileDir(dir);
    await writeFile(join(dir, "Cookies"), "x");
    await removeProfileDir(dir);
    await expect(stat(dir)).rejects.toThrow();
  });

  it("refuse un chemin relatif ou un dossier non vide (sans jamais le supprimer)", async () => {
    const base = await mkdtemp(join(tmpdir(), "selio-cloud-test-"));
    roots.push(base);
    await expect(prepareProfileDir("relatif/profil")).rejects.toBeInstanceOf(ProfileDirError);
    await writeFile(join(base, "a-garder.txt"), "x");
    await expect(prepareProfileDir(base)).rejects.toBeInstanceOf(ProfileDirError);
    expect(await readdir(base)).toContain("a-garder.txt");
  });

  it("au démarrage (seuil 0), balaie tous les dossiers selio-cloud-* quel que soit leur âge", async () => {
    const base = await mkdtemp(join(tmpdir(), "selio-cloud-test-"));
    roots.push(base);
    for (const n of [`${PROFILE_PREFIX}a`, `${PROFILE_PREFIX}b`, "autre"]) await mkdir(join(base, n));
    expect(await sweepStaleProfiles(base, 0)).toBe(2);
    expect(await readdir(base)).toEqual(["autre"]);
  });

  it("balaie les profils oubliés plus vieux qu'une heure", async () => {
    const base = await mkdtemp(join(tmpdir(), "selio-cloud-test-"));
    roots.push(base);
    const old = join(base, `${PROFILE_PREFIX}old`);
    const recent = join(base, `${PROFILE_PREFIX}recent`);
    const other = join(base, "autre-dossier");
    for (const d of [old, recent, other]) await mkdir(d);
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    await utimes(old, twoHoursAgo, twoHoursAgo);
    await utimes(other, twoHoursAgo, twoHoursAgo);
    expect(await sweepStaleProfiles(base)).toBe(1);
    expect((await readdir(base)).sort()).toEqual(["autre-dossier", `${PROFILE_PREFIX}recent`]);
  });
});
