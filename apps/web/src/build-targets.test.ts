// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

/**
 * Les deux sites construits pour de vrai (vite build), comme sur Netlify :
 * - « public » avec l'API de production : aucune page ni aucun texte de Selio Admin, aucun client de démonstration ;
 * - « admin » : Selio Admin seul, jamais indexé (robots.txt, en-tête X-Robots-Tag, balise robots), sans sitemap ni PWA.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "selio-cibles-"));

/** Textes propres aux pages de Selio Admin (barre latérale, refus, supervision, fiche compte). */
const ADMIN_MARKERS = ["Sections de l'administration", "Page réservée à l'opérateur technique", "Cibles vérifiées chaque minute", "Qualifier « Équipe Selio »", "Selio Admin", "Accès réservé à l'équipe Selio"];
/** Client de démonstration et entrée /demo : jamais livrés en production. */
const DEMO_MARKERS = ["Session de démonstration absente", "Préparation des données de démonstration", "Ouvrir la démonstration"];

async function buildTarget(target: "public" | "admin", apiBase: string, outDir: string): Promise<void> {
  const saved = { target: process.env.VITE_APP_TARGET, api: process.env.VITE_API_BASE_URL };
  process.env.VITE_APP_TARGET = target;
  process.env.VITE_API_BASE_URL = apiBase;
  try {
    await build({ root: webRoot, configFile: join(webRoot, "vite.config.ts"), logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    if (saved.target === undefined) delete process.env.VITE_APP_TARGET;
    else process.env.VITE_APP_TARGET = saved.target;
    if (saved.api === undefined) delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL = saved.api;
  }
}

function readAll(dir: string, ext = /\.(js|html)$/): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, name.name);
      if (name.isDirectory()) walk(full);
      else if (ext.test(name.name)) out.set(full.slice(dir.length + 1), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

const filesWith = (files: Map<string, string>, text: string) => [...files].filter(([, body]) => body.includes(text)).map(([name]) => name);

const pub = join(work, "public");
const adm = join(work, "admin");

beforeAll(async () => {
  await buildTarget("public", "https://seliovprod.netlify.app", pub);
  await buildTarget("admin", "https://seliovprod-admin.netlify.app", adm);
}, 240_000);

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("build « public » (production)", () => {
  it("ne contient aucune page ni aucun texte de Selio Admin", () => {
    const files = readAll(pub);
    expect(files.size).toBeGreaterThan(20);
    for (const marker of ADMIN_MARKERS) expect(filesWith(files, marker), marker).toEqual([]);
  });

  it("ne livre ni le client de démonstration ni l'entrée /demo", () => {
    const files = readAll(pub);
    for (const marker of DEMO_MARKERS) expect(filesWith(files, marker), marker).toEqual([]);
  });

  it("reste indexable et installable (PWA)", () => {
    const html = readFileSync(join(pub, "index.html"), "utf8");
    expect(html).not.toMatch(/noindex/);
    expect(existsSync(join(pub, "manifest.webmanifest"))).toBe(true);
    expect(existsSync(join(pub, "sitemap.xml"))).toBe(true);
    expect(existsSync(join(pub, "_headers"))).toBe(false);
  });
});

describe("build « admin »", () => {
  it("Selio Admin seul : sa propre entrée, aucune page de la vitrine", () => {
    const files = readAll(adm);
    expect(filesWith(files, "Sections de l'administration").length).toBeGreaterThan(0);
    for (const vitrine of ["Commencer l'essai gratuit", "Générer une annonce"]) expect(filesWith(files, vitrine), vitrine).toEqual([]);
  });

  it("jamais indexé : balise robots, robots.txt « Disallow: / », en-tête X-Robots-Tag, ni sitemap, ni partage, ni PWA", () => {
    const html = readFileSync(join(adm, "index.html"), "utf8");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain("<title>Selio Admin</title>");
    expect(html).not.toMatch(/og:|twitter:|ld\+json|manifest/);
    expect(readFileSync(join(adm, "robots.txt"), "utf8")).toMatch(/^Disallow: \/$/m);
    expect(readFileSync(join(adm, "_headers"), "utf8")).toMatch(/^\/\*\n {2}X-Robots-Tag: noindex, nofollow$/m);
    for (const f of ["sitemap.xml", "manifest.webmanifest", "sw.js", "og", "demo"]) expect(existsSync(join(adm, f)), f).toBe(false);
  });
});
