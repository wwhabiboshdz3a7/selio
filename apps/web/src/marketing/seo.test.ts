import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SPACE_PREFIXES } from "../app/spaces/paths";
import { EXTENSION_PRIVACY } from "./extensionPrivacy";
import { PRODUCTS } from "./products";
import { COMPARISON_READY, INDEPENDENCE_NOTICE, SEO_PAGES, SITE_ORIGIN, TARGET_KEYWORDS, findForbiddenClaims, organizationJsonLd, serializeJsonLd } from "./seo";

const webRoot = join(__dirname, "..", "..");
const repoRoot = join(webRoot, "..", "..");
const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");

/** Tous les fichiers d'un dossier, récursivement, filtrés par extension. */
function walk(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => name.endsWith(e)) ? [full] : [];
  });
}

/** Normalise les apostrophes et espaces (le Markdown et le TypeScript n'ont pas toujours les mêmes). */
const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("vitrine › référencement", () => {
  it("chaque page a un titre unique et une description de 160 caractères au plus", () => {
    const titles = SEO_PAGES.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const p of SEO_PAGES) {
      expect(p.title.length, p.path).toBeGreaterThan(3);
      expect(p.description.length, p.path).toBeGreaterThan(50);
      expect(p.description.length, `${p.path} : ${p.description.length} caractères`).toBeLessThanOrEqual(160);
      expect(p.priority).toBeGreaterThan(0);
      expect(p.priority).toBeLessThanOrEqual(1);
    }
  });

  it("une page par filiale, sous /produits, sans empiéter sur les adresses de l'application", () => {
    expect(PRODUCTS.map((p) => p.slug)).toEqual(["manager", "studio", "track", "radar", "cloud", "comptes"]);
    for (const p of PRODUCTS) {
      expect(SEO_PAGES.some((s) => s.path === p.path && s.indexable)).toBe(true);
      const path: string = p.path;
      for (const [prefix] of SPACE_PREFIXES) expect(path === prefix || path.startsWith(`${prefix}/`)).toBe(false);
      expect(p.does.length).toBeGreaterThanOrEqual(3);
      expect(p.doesNot.length).toBeGreaterThanOrEqual(3);
      expect(p.pricingHref.startsWith("/tarifs")).toBe(true);
    }
  });

  it("chaque page référencée a sa route dans router.tsx", () => {
    const router = read(webRoot, "src", "router.tsx");
    const routes = new Set([...router.matchAll(/path: "([^"]+)"/g)].map((m) => `/${m[1]}`));
    for (const p of SEO_PAGES) {
      if (p.path === "/") continue;
      const direct = routes.has(p.path);
      const product = p.path.startsWith("/produits/") && routes.has("/produits/:slug") && PRODUCTS.some((x) => x.path === p.path);
      expect(direct || product, p.path).toBe(true);
    }
  });

  it("sitemap.xml : exactement les pages indexables, sur le domaine de SITE_ORIGIN", () => {
    const xml = read(webRoot, "public", "sitemap.xml");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    for (const loc of locs) expect(loc.startsWith(`${SITE_ORIGIN}/`), loc).toBe(true);
    const paths = locs.map((l) => l.slice(SITE_ORIGIN.length)).sort();
    const expected = SEO_PAGES.filter((p) => p.indexable).map((p) => p.path).sort();
    expect(paths).toEqual(expected);
    // Les comparatifs restent hors du sitemap tant que les textes d'Elias manquent.
    if (!COMPARISON_READY) expect(paths).not.toContain("/selio-ou-bleam");
    expect(paths).not.toContain("/mentions-legales");
  });

  it("robots.txt : application exclue, pages publiques permises, sitemap déclaré", () => {
    const robots = read(webRoot, "public", "robots.txt");
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    const disallowed = [...robots.matchAll(/^Disallow: (\S+)/gm)].map((m) => m[1]!);
    for (const prefix of ["/app", ...SPACE_PREFIXES.map(([p]) => p)]) expect(disallowed).toContain(prefix);
    for (const p of SEO_PAGES.filter((x) => x.indexable)) {
      // robots.txt compare des préfixes : « Disallow: /app » bloquerait aussi « /application ».
      for (const d of disallowed) expect(p.path.startsWith(d), `${p.path} bloquée par ${d}`).toBe(false);
    }
  });

  it("index.html : même domaine, données structurées valides, mention d'indépendance", () => {
    const html = read(webRoot, "index.html");
    expect(html).toContain(INDEPENDENCE_NOTICE);
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(block).not.toBeNull();
    const data = JSON.parse(block![1]!);
    const org = data["@graph"].find((n: { "@type": string }) => n["@type"] === "Organization");
    expect(org["@id"]).toBe(organizationJsonLd()["@id"]);
    expect(org.url).toBe(`${SITE_ORIGIN}/`);
    // Aucune note ni aucun avis inventé dans les données structurées.
    expect(html).not.toMatch(/aggregateRating|"review"/);
  });

  it("mots-clés visés présents dans les titres et descriptions", () => {
    const text = SEO_PAGES.map((p) => `${p.title} ${p.description}`).join(" ").toLowerCase();
    for (const k of TARGET_KEYWORDS) {
      const [, competitor] = /^alternative à (.+)$/.exec(k) ?? [];
      if (competitor) expect(text.includes("alternative à") && text.includes(competitor.toLowerCase()), k).toBe(true);
      else expect(text, k).toContain(k.toLowerCase());
    }
  });

  it("données structurées : rien ne peut fermer la balise script", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("vitrine › promesses interdites", () => {
  it("détecte les promesses interdites et tolère la mention d'indépendance", () => {
    for (const bad of ["Première position sur Google garantie", "Une automatisation zéro risque", "Outil 100 % légal", "Partenaire officiel de Vinted", "Approuvé par Vinted", "sans aucun risque pour votre compte", "Top 3 sur Google"]) {
      expect(findForbiddenClaims(bad).length, bad).toBeGreaterThan(0);
    }
    for (const ok of [INDEPENDENCE_NOTICE, "Selio est un outil indépendant, ni affilié à Vinted ni approuvé par Vinted.", "Aucune promesse d'absence de risque.", "Parle d'un risque « faible », jamais nul."]) {
      expect(findForbiddenClaims(ok), ok).toEqual([]);
    }
  });

  it("aucun texte de la vitrine, de l'extension ni de sa fiche ne contient de promesse interdite", () => {
    const files = [
      ...walk(join(webRoot, "src", "marketing"), [".ts", ".tsx"]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.endsWith(`${join("marketing", "seo.ts")}`)),
      join(webRoot, "index.html"),
      ...walk(join(repoRoot, "apps", "extension", "src"), [".ts", ".tsx", ".html"]),
      ...walk(join(repoRoot, "apps", "extension", "store"), [".md"]),
      join(repoRoot, "apps", "extension", "manifest.json"),
      join(repoRoot, "apps", "extension", "public", "_locales", "fr", "messages.json"),
    ];
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.flatMap((f) => findForbiddenClaims(readFileSync(f, "utf8")).map((c) => `${f.slice(repoRoot.length)} : ${c.label} (« ${c.match} »)`));
    expect(offenders).toEqual([]);
  });
});

describe("vitrine › mention d'indépendance", () => {
  it("présente dans le pied de page, les pages légales, la fiche et la politique de l'extension", () => {
    const marketing = (f: string) => read(webRoot, "src", "marketing", f);
    expect(marketing("layout.tsx")).toContain("{INDEPENDENCE_NOTICE}");
    expect(marketing("pages/Legal.tsx")).toMatch(/INDEPENDENCE_NOTICE/);
    for (const page of ["pages/Extension.tsx", "pages/ExtensionPrivacy.tsx", "pages/Product.tsx", "pages/SelioOrBleam.tsx", "pages/Platform.tsx"]) expect(marketing(page), page).toContain("<IndependenceNotice");
    const store = join(repoRoot, "apps", "extension", "store");
    for (const f of ["listing.md", "privacy-policy.md"]) expect(norm(read(store, f)), f).toContain(INDEPENDENCE_NOTICE);
    for (const f of ["popup/main.tsx", "options/main.tsx"]) expect(norm(read(repoRoot, "apps", "extension", "src", f)), f).toContain(INDEPENDENCE_NOTICE);
  });

  it("la politique de confidentialité de l'extension est la même sur le site et dans la fiche", () => {
    const md = norm(read(repoRoot, "apps", "extension", "store", "privacy-policy.md"));
    for (const section of EXTENSION_PRIVACY) {
      expect(md, section.h).toContain(norm(section.h));
      for (const p of section.p) expect(md, p).toContain(norm(p));
    }
  });
});
