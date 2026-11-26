import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, type PgPool } from "@selio/db";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";
import { DUPLICATE_REQUEST_MESSAGE } from "../src/plugins/double-submit";

/**
 * Robustesse avant lancement (docs/ROBUSTESSE.md) : double clic sur les actions sensibles, inscription après
 * suppression du compte, noms longs ou absurdes, valeurs et dates absurdes, photos illisibles, envois énormes,
 * erreurs toujours en français. Base dédiée selio_test_api_robustesse (créée si besoin), jamais celle d'un autre
 * fichier de test. Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_ROBUSTESSE_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_robustesse";
const APP_URL = process.env.TEST_API_ROBUSTESSE_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_robustesse";
const ENCRYPTION_KEY = SecretBox.generateKey();
const PASSWORD = "motdepasse-R1";

let available = true;
let owner: PgPool;
let built: BuiltServer;

async function ensureDatabase(): Promise<void> {
  const url = new URL(OWNER_URL);
  const dbName = url.pathname.replace(/^\//, "");
  url.pathname = "/postgres";
  const admin = createPool(url.toString(), { max: 1 });
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database "${dbName.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? "").split(";")[0] ?? "";
}

interface Res { status: number; json: { error?: { code: string; message: string; details?: unknown } } & Record<string, unknown>; body: string }

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie: string | null, payload?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await built.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as string } : {}), headers: { ...(cookie ? { cookie } : {}), ...headers } });
  let json: Res["json"] = {};
  try { json = r.body ? JSON.parse(r.body) : {}; } catch { json = {}; }
  return { status: r.statusCode, json, body: r.body };
}

/** Inscriptions limitées à 10 par quart d'heure et par adresse IP : chaque inscription du test vient d'une adresse différente. */
let ipCounter = 0;
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

async function register(email: string, extra: Record<string, unknown> = {}): Promise<{ res: Res; cookie: string }> {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", remoteAddress: nextIp(), payload: { email, password: PASSWORD, displayName: "Camille", orgName: `Boutique ${email}`, ...extra } });
  const res: Res = { status: r.statusCode, json: JSON.parse(r.body || "{}"), body: r.body };
  return { res, cookie: cookieOf(r) };
}

/** Aucun message technique : ni anglais de Fastify, ni pile d'appels, ni « Internal Server Error ». */
function expectFrenchError(res: Res): void {
  const message = res.json.error?.message ?? "";
  expect(message.length).toBeGreaterThan(5);
  expect(message).not.toMatch(/Internal Server Error|Body cannot|Unexpected token|Rate limit|at .*\.ts:\d+|Expected|must contain|invalid input/i);
}

/** Vrais en-têtes d'image (octets magiques), suffisants pour le contrôle du type réel. */
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const jpegDataUrl = `data:image/jpeg;base64,${Buffer.concat([JPEG_HEAD, Buffer.from("photo-robustesse")]).toString("base64")}`;
const pdfAsJpeg = `data:image/jpeg;base64,${Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n").toString("base64")}`;
const heicAsJpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(12)]).toString("base64")}`;
const svgAsPng = `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`;
const emptyJpeg = "data:image/jpeg;base64,";

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  // Stockage configuré (signature locale, aucun appel réseau) pour les URL présignées ; paiement simulé (aucune clé Revolut).
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_ENV: "test", LOG_LEVEL: "silent", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", PUBLIC_WEB_URL: "https://app.selio.test", STORAGE_ENDPOINT: "http://127.0.0.1:9000", STORAGE_BUCKET: "selio-photos", STORAGE_ACCESS_KEY: "selio-minio", STORAGE_SECRET_KEY: "selio-minio-secret" });
  built = await buildServer(env, {}, { priceModelRefreshMs: 0 });
  await built.app.ready();
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("1. double clic sur une action sensible", () => {
  it("inscription envoyée deux fois au même instant : un seul compte, le second envoi refusé clairement", async () => {
    if (!available) return;
    const payload = { email: "double@robustesse.test", password: PASSWORD, displayName: "Double", orgName: "Boutique Double" };
    const ip = nextIp();
    const [a, b] = await Promise.all([0, 1].map(() => built.app.inject({ method: "POST", url: "/api/auth/register", remoteAddress: ip, payload })));
    expect([a!.statusCode, b!.statusCode].sort()).toEqual([201, 409]);
    const refused = JSON.parse((a!.statusCode === 409 ? a! : b!).body);
    expect(refused.error.message).toMatch(/déjà/);
    expect((await owner.query("select count(*)::int as n from users where email = 'double@robustesse.test'")).rows[0].n).toBe(1);
    expect((await owner.query("select count(*)::int as n from organizations where name = 'Boutique Double'")).rows[0].n).toBe(1);
  });

  it("deux inscriptions différentes avec la même adresse au même instant (deux onglets) : un seul compte, message « compte existe déjà »", async () => {
    if (!available) return;
    const [a, b] = await Promise.all([1, 2].map((n) => built.app.inject({ method: "POST", url: "/api/auth/register", remoteAddress: nextIp(), payload: { email: "course@robustesse.test", password: PASSWORD, displayName: `Onglet ${n}`, orgName: `Boutique onglet ${n}` } })));
    expect([a!.statusCode, b!.statusCode].sort()).toEqual([201, 409]);
    const refused = JSON.parse((a!.statusCode === 409 ? a! : b!).body);
    expect(refused.error.message).toMatch(/Un compte existe déjà avec cet email/);
    expect((await owner.query("select count(*)::int as n from users where email = 'course@robustesse.test'")).rows[0].n).toBe(1);
  });

  it("création d'article envoyée deux fois : un seul article", async () => {
    if (!available) return;
    const { cookie } = await register("articles@robustesse.test");
    const item = { title: "Veste en jean double clic", purchasePriceCents: 500, listedPriceCents: 2500 };
    const [a, b] = await Promise.all([0, 1].map(() => call("POST", "/api/items", cookie, item)));
    expect([a!.status, b!.status].sort()).toEqual([201, 409]);
    const refused = a!.status === 409 ? a! : b!;
    expect(refused.json.error).toMatchObject({ code: "duplicate_request", message: DUPLICATE_REQUEST_MESSAGE });
    const list = await call("GET", "/api/items?q=double%20clic", cookie);
    expect((list.json as unknown as { total: number }).total).toBe(1);
    // Un autre article (corps différent) passe tout de suite : seul le doublon exact est bloqué.
    expect((await call("POST", "/api/items", cookie, { ...item, title: "Autre veste" })).status).toBe(201);
  });

  it("paiement simulé « Confirmer » cliqué deux fois : l'offre n'est enregistrée qu'une fois", async () => {
    if (!available) return;
    const { cookie } = await register("paiement@robustesse.test");
    const [a, b] = await Promise.all([0, 1].map(() => call("POST", "/api/billing/checkout", cookie, { plan: "pro", cycle: "monthly" })));
    expect([a!.status, b!.status].sort()).toEqual([200, 409]);
    expect((a!.status === 409 ? a! : b!).json.error?.code).toBe("duplicate_request");
    const audits = await owner.query("select count(*)::int as n from audit_logs a join organizations o on o.id = a.org_id where o.name = 'Boutique paiement@robustesse.test' and a.action = 'billing.simulated_checkout'");
    expect(audits.rows[0].n).toBe(1);
  });
});

describe("2. modification concurrente d'un article (deux onglets)", () => {
  it("l'onglet resté sur l'ancienne version reçoit un conflit clair au lieu d'écraser en silence", async () => {
    if (!available) return;
    const { cookie } = await register("onglets@robustesse.test");
    const created = await call("POST", "/api/items", cookie, { title: "Pull marin", listedPriceCents: 2000 });
    const openedAt = created.json.updatedAt as string;
    // Onglet A enregistre.
    const a = await call("PATCH", `/api/items/${created.json.id}`, cookie, { title: "Pull marin rayé", expectedUpdatedAt: openedAt });
    expect(a.status).toBe(200);
    // Onglet B, ouvert avant, enregistre à son tour : refusé, rien n'est écrasé.
    const b = await call("PATCH", `/api/items/${created.json.id}`, cookie, { listedPriceCents: 1500, expectedUpdatedAt: openedAt });
    expect(b.status).toBe(409);
    expect(b.json.error?.code).toBe("item_conflict");
    expect(b.json.error?.message).toMatch(/modifié entre-temps/);
    const now = await call("GET", `/api/items/${created.json.id}`, cookie);
    expect(now.json).toMatchObject({ title: "Pull marin rayé", listedPriceCents: 2000 });
    // Sans date attendue (anciens clients, extension), la modification reste possible.
    expect((await call("PATCH", `/api/items/${created.json.id}`, cookie, { listedPriceCents: 1800 })).status).toBe(200);
  });
});

describe("4. noms longs, vides, emojis, HTML", () => {
  it("nom affiché et nom d'organisation : limites claires, espaces seuls et caractères de contrôle refusés, HTML gardé comme du texte", async () => {
    if (!available) return;
    const long80 = "A".repeat(80);
    const ok = await register("nom80@robustesse.test", { displayName: long80, orgName: "O".repeat(120) });
    expect(ok.res.status).toBe(201);
    for (const [displayName, pattern] of [["B".repeat(81), /80 caractères au plus/], ["x".repeat(500), /80 caractères au plus/], ["   ", /champ requis/i], ["​​", /espaces seuls/], ["Camille\nDupont", /Caractère non accepté/i]] as const) {
      const r = await register(`nom-${displayName.length}-${displayName.charCodeAt(0)}@robustesse.test`, { displayName });
      expect(r.res.status).toBe(400);
      expect(r.res.json.error?.message).toMatch(pattern);
      expect(r.res.json.error?.message).toMatch(/^Inscription invalide — Votre nom/);
    }
    const orgTooLong = await register("org121@robustesse.test", { orgName: "O".repeat(121) });
    expect(orgTooLong.res.status).toBe(400);
    expect(orgTooLong.res.json.error?.message).toMatch(/Nom de l'organisation : 120 caractères au plus/);
    const html = '<img src=x onerror="alert(1)">😀 Zoé & Cie';
    const fancy = await register("html@robustesse.test", { displayName: html, orgName: "🛍️ Friperie « L'Été » <b>"} );
    expect(fancy.res.status).toBe(201);
    const session = await call("GET", "/api/auth/session", fancy.cookie);
    expect((session.json as unknown as { user: { displayName: string } }).user.displayName).toBe(html);
  });

  it("renommer l'organisation : 121 caractères ou espaces seuls refusés avec un message clair", async () => {
    if (!available) return;
    const { cookie } = await register("renommer@robustesse.test");
    const tooLong = await call("PATCH", "/api/org", cookie, { name: "N".repeat(121) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.error?.message).toMatch(/120 caractères au plus/);
    expect((await call("PATCH", "/api/org", cookie, { name: "    " })).status).toBe(400);
    expect((await call("PATCH", "/api/org", cookie, { name: "Nouvelle boutique ✨" })).status).toBe(200);
  });

  it("titre d'article : 200 caractères au plus, caractère nul refusé proprement (400, jamais 500)", async () => {
    if (!available) return;
    const { cookie } = await register("titres@robustesse.test");
    const long = await call("POST", "/api/items", cookie, { title: "T".repeat(201) });
    expect(long.status).toBe(400);
    expect(long.json.error?.message).toMatch(/Titre : 200 caractères au plus/);
    const nul = await call("POST", "/api/items", cookie, { title: "Veste\u0000cachée" });
    expect(nul.status).toBe(400);
    expectFrenchError(nul);
    // Caractère nul dans un champ libre (description) : la base le refuse, l'API répond 400 en français.
    const desc = await call("POST", "/api/items", cookie, { title: "Veste", description: "a\u0000b" });
    expect(desc.status).toBe(400);
    expect(desc.json.error?.message).toMatch(/caractère non accepté/);
  });
});

describe("5. suppression du compte puis réinscription avec le même email", () => {
  it("l'adresse est libérée, le nouveau compte part de zéro (aucune ancienne donnée)", async () => {
    if (!available) return;
    const first = await register("revenante@robustesse.test", { orgName: "Ancienne boutique" });
    expect((await call("POST", "/api/items", first.cookie, { title: "Article de l'ancien compte" })).status).toBe(201);
    const del = await call("DELETE", "/api/org", first.cookie, { confirmName: "Ancienne boutique" });
    expect(del.status).toBe(204);
    expect((await owner.query("select count(*)::int as n from users where email = 'revenante@robustesse.test'")).rows[0].n).toBe(0);
    // L'ancienne session ne mène plus nulle part.
    expect((await call("GET", "/api/items", first.cookie)).status).toBe(401);
    const again = await register("revenante@robustesse.test", { orgName: "Nouvelle boutique" });
    expect(again.res.status).toBe(201);
    const items = await call("GET", "/api/items", again.cookie);
    expect((items.json as unknown as { total: number }).total).toBe(0);
    // Constat (aucune règle métier inventée) : un nouvel essai de 14 jours démarre, rien ne retient l'essai déjà consommé.
    const sub = await call("GET", "/api/billing/subscription", again.cookie);
    expect(sub.json).toMatchObject({ status: "trialing" });
  });

  it("membre retiré de sa seule organisation : il peut se réinscrire avec la même adresse", async () => {
    if (!available) return;
    const ownerAccount = await register("titulaire@robustesse.test");
    const invite = await call("POST", "/api/org/members", ownerAccount.cookie, { email: "retire@robustesse.test", role: "operator" });
    expect(invite.status).toBe(201);
    const members = await call("GET", "/api/org/members", ownerAccount.cookie);
    const member = (members.json as unknown as { id: string; user: { email: string } }[]).find((m) => m.user.email === "retire@robustesse.test")!;
    expect((await call("DELETE", `/api/org/members/${member.id}`, ownerAccount.cookie)).status).toBe(204);
    const again = await register("retire@robustesse.test");
    expect(again.res.status).toBe(201);
    // Un compte qui appartient encore à une organisation reste protégé.
    const taken = await register("titulaire@robustesse.test");
    expect(taken.res.status).toBe(409);
    expect(taken.res.json.error?.message).toMatch(/Un compte existe déjà/);
  });
});

describe("6. envois énormes", () => {
  it("URL présignée : plusieurs Go demandés → refus clair avec la taille maximale", async () => {
    if (!available) return;
    const { cookie } = await register("upload@robustesse.test");
    for (const size of [6 * 1024 * 1024, 3 * 1024 ** 3, 50 * 1024 ** 4]) {
      const r = await call("POST", "/api/uploads/presign", cookie, { kind: "studio-photo", contentType: "image/jpeg", size });
      expect(r.status).toBe(400);
      expect(r.json.error?.message).toBe("Fichier trop lourd : 5 Mo au maximum.");
    }
    for (const size of [0, -1, 1.5]) {
      const r = await call("POST", "/api/uploads/presign", cookie, { kind: "studio-photo", contentType: "image/jpeg", size });
      expect(r.status).toBe(400);
      expect(r.json.error?.message).toMatch(/Taille invalide/);
    }
  });

  it("corps de requête au-delà de la limite : 413 en français, sans lire le reste", async () => {
    if (!available) return;
    const { cookie } = await register("lourd@robustesse.test");
    const r = await call("POST", "/api/items", cookie, JSON.stringify({ title: "x", description: "y".repeat(3 * 1024 * 1024) }), { "content-type": "application/json" });
    expect(r.status).toBe(413);
    expect(r.json.error?.message).toMatch(/Envoi trop lourd/);
  });
});

describe("7-8. dates, prix et quantités absurdes", () => {
  it("article : prix à 1 000 000 €, prix affiché à 0 €, négatif, plancher au-dessus du prix, date d'achat future ou impossible", async () => {
    if (!available) return;
    const { cookie } = await register("absurde@robustesse.test");
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ listedPriceCents: 100_000_000 }, /Prix affiché : montant trop élevé : 100 000 € au plus/],
      [{ listedPriceCents: 0 }, /au moins 1 €/],
      [{ purchasePriceCents: -500 }, /Article invalide/],
      [{ listedPriceCents: 2000, floorPriceCents: 3000 }, /plancher ne peut pas dépasser/],
      [{ purchasedAt: new Date(Date.now() + 10 * 86_400_000).toISOString() }, /ne peut pas être dans le futur/],
      [{ purchasedAt: "1900-01-01T00:00:00.000Z" }, /1950 au plus tôt/],
      [{ purchasedAt: "2026-13-45T00:00:00.000Z" }, /Date invalide/i],
      [{ purchasedAt: "2026-02-30T00:00:00.000Z" }, /Date invalide/i],
    ];
    for (const [fields, pattern] of cases) {
      const r = await call("POST", "/api/items", cookie, { title: `Article ${JSON.stringify(fields)}`, ...fields });
      expect(r.status, JSON.stringify(fields)).toBe(400);
      expect(r.json.error?.message, JSON.stringify(fields)).toMatch(pattern);
    }
    // Valeurs raisonnables acceptées (achat d'hier, prix à 1 €, prix de luxe à 15 000 €).
    const fine = await call("POST", "/api/items", cookie, { title: "Sac de luxe", listedPriceCents: 1_500_000, floorPriceCents: 100, purchasedAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(fine.status).toBe(201);
    // Modification : plancher au-dessus du prix déjà enregistré refusé aussi.
    const patch = await call("PATCH", `/api/items/${fine.json.id}`, cookie, { floorPriceCents: 1_600_000 });
    expect(patch.status).toBe(400);
    expect(patch.json.error?.message).toMatch(/plancher/);
  });
});

describe("10. photo illisible ou d'un autre type", () => {
  it("PDF renommé, HEIC, SVG, fichier vide : refus clair ; vraie image JPEG acceptée", async () => {
    if (!available) return;
    const { cookie } = await register("photos@robustesse.test");
    const cases: [string, RegExp][] = [[pdfAsJpeg, /document PDF/], [heicAsJpeg, /HEIC/], [svgAsPng, /SVG/], [emptyJpeg, /vide|n'est pas une image/]];
    for (const [url, pattern] of cases) {
      const r = await call("POST", "/api/items", cookie, { title: `Photo ${pattern.source}`, photos: [{ id: "p1", url, alt: "photo.jpg" }] });
      expect(r.status, pattern.source).toBe(400);
      expect(r.json.error?.message, pattern.source).toMatch(pattern);
    }
    const ok = await call("POST", "/api/items", cookie, { title: "Avec une vraie photo", photos: [{ id: "p1", url: jpegDataUrl, alt: "veste.jpg" }] });
    expect(ok.status).toBe(201);
    // Ajout de photos (contributeur photos) : même contrôle.
    const add = await call("POST", `/api/items/${ok.json.id}/photos`, cookie, { photos: [{ url: pdfAsJpeg, alt: "facture.jpg" }] });
    expect(add.status).toBe(400);
    expect(add.json.error?.message).toMatch(/« facture\.jpg » est un document PDF/);
  });
});

describe("erreurs inattendues : toujours un message clair en français", () => {
  it("corps illisible, corps vide, corps nul, type de contenu inconnu", async () => {
    if (!available) return;
    const { cookie } = await register("erreurs@robustesse.test");
    const broken = await call("POST", "/api/items", cookie, "{ pas du json", { "content-type": "application/json" });
    expect(broken.status).toBe(400);
    expectFrenchError(broken);
    const empty = await call("POST", "/api/items", cookie, "", { "content-type": "application/json" });
    expect(empty.status).toBe(400);
    expectFrenchError(empty);
    const nullBody = await call("POST", "/api/items/inconnu/status", cookie, "null", { "content-type": "application/json" });
    expect(nullBody.status).toBeLessThan(500);
    expectFrenchError(nullBody);
    const xml = await call("POST", "/api/items", cookie, "<item/>", { "content-type": "application/xml" });
    expect(xml.status).toBe(415);
    expectFrenchError(xml);
  });
});
