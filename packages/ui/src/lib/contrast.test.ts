import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLACK_RGB,
  WCAG_AA,
  WHITE_RGB,
  compositeOver,
  contrastRatio,
  parseHexColor,
  relativeLuminance,
} from "./contrast";

const tokensCss = readFileSync(
  resolvePath(dirname(fileURLToPath(import.meta.url)), "../styles/tokens.css"),
  "utf8",
);

/** Déclarations d'un bloc CSS (premier bloc dont l'en-tête correspond). */
function block(header: string): Map<string, string> {
  const start = tokensCss.indexOf(header);
  if (start < 0) throw new Error(`Bloc introuvable : ${header}`);
  const open = tokensCss.indexOf("{", start);
  const close = tokensCss.indexOf("\n}", open);
  const body = tokensCss.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const light = block(":root {");
const darkForced = block(':root[data-theme="dark"] {');
const darkSystem = block(':root:not([data-theme="light"]) {');

/** Résout var(--x) récursivement (valeurs du bloc d'abord, puis du bloc clair). */
function resolve(name: string, scope: Map<string, string> = light): string {
  const raw = scope.get(name) ?? light.get(name);
  if (raw === undefined) throw new Error(`Token absent : ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  return ref ? resolve(ref[1]!, scope) : raw;
}

describe("contrastRatio (WCAG 2.x)", () => {
  it("donne 21:1 pour noir sur blanc et 1:1 pour une couleur sur elle-même", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE_RGB, BLACK_RGB)).toBeCloseTo(21, 5);
    expect(contrastRatio("#6442D6", "#6442D6")).toBe(1);
  });

  it("est symétrique et retrouve les valeurs de référence", () => {
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#FFFFFF", "#777777")).toBeCloseTo(
      contrastRatio("#777777", "#FFFFFF"),
      10,
    );
    // Violet 600 + texte blanc : la charte annonce au moins 6:1.
    expect(contrastRatio("#6442D6", "#FFFFFF")).toBeGreaterThan(6);
  });

  it("calcule la luminance relative et refuse une notation invalide", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(parseHexColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(() => parseHexColor("violet")).toThrow(/Couleur invalide/);
  });

  it("compose une couche translucide comme le navigateur (mélange sRGB)", () => {
    expect(compositeOver(WHITE_RGB, 0.5, BLACK_RGB)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(compositeOver("#FFFFFF", 1, "#000000")).toEqual(WHITE_RGB);
    expect(compositeOver("#FFFFFF", 0, "#000000")).toEqual(BLACK_RGB);
  });
});

describe("rôles de texte de tokens.css (WCAG AA)", () => {
  const themes = { clair: light, "sombre forcé": darkForced, "sombre système": darkSystem } as const;
  // Texte courant : 4,5:1 sur les trois fonds de l'application (page, carte, zone atténuée).
  const textRoles = ["--text", "--text-muted", "--accent", "--gold-text", "--success", "--warning", "--danger"];
  const backgrounds = ["--bg", "--surface", "--surface-muted"];

  it.each(Object.keys(themes) as (keyof typeof themes)[])("%s : chaque rôle de texte tient 4,5:1 sur chaque fond", (theme) => {
    const scope = themes[theme];
    for (const role of textRoles)
      for (const bg of backgrounds) {
        const ratio = contrastRatio(resolve(role, scope), resolve(bg, scope));
        expect(ratio, `${theme} ${role} sur ${bg}`).toBeGreaterThanOrEqual(WCAG_AA);
      }
  });

  it("les boutons pleins (accent, principal) tiennent 4,5:1 avec leur texte", () => {
    for (const scope of Object.values(themes)) {
      expect(contrastRatio(resolve("--on-accent", scope), resolve("--accent", scope))).toBeGreaterThanOrEqual(WCAG_AA);
      expect(contrastRatio(resolve("--on-primary", scope), resolve("--primary", scope))).toBeGreaterThanOrEqual(WCAG_AA);
    }
  });
});
