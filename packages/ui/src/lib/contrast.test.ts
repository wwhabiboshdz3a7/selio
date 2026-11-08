import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLACK_RGB,
  GLASS_COLORED_ROLES,
  GLASS_ROLE_COLORS,
  WCAG_AA,
  WHITE_RGB,
  compositeOver,
  contrastRatio,
  parseHexColor,
  relativeLuminance,
  scrimAlphaFor,
  scrimContrast,
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

const percent = (value: string) => {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (!m) throw new Error(`Pourcentage attendu, reçu « ${value} »`);
  return Number(m[1]) / 100;
};

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

describe("scrimAlphaFor", () => {
  const roles = [
    { tone: "light", role: "text" },
    { tone: "light", role: "text-muted" },
    { tone: "dark", role: "text" },
    { tone: "dark", role: "text-muted" },
  ] as const;

  it.each(roles)(
    "garantit 4,5:1 sur blanc ET noir pour $tone / $role, et c'est le minimum au centième",
    (role) => {
      const alpha = scrimAlphaFor(role, "both");
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1);
      expect(scrimContrast(role, alpha, "both")).toBeGreaterThanOrEqual(WCAG_AA);
      // Un centième de moins ne suffit plus : la valeur est bien minimale.
      expect(scrimContrast(role, alpha - 0.01, "both")).toBeLessThan(WCAG_AA);
      // Toute opacité supérieure reste conforme.
      for (let a = alpha; a <= 1; a += 0.05)
        expect(scrimContrast(role, a, "both")).toBeGreaterThanOrEqual(WCAG_AA);
    },
  );

  it("garantit le seuil sur n'importe quel fond intermédiaire (gris, couleurs vives)", () => {
    const fonds = [
      "#808080",
      "#FF0000",
      "#00FF00",
      "#0000FF",
      "#FFFF00",
      "#7C5CEB",
      "#D4AC57",
      "#3A3A3A",
      "#C8C8C8",
    ];
    for (const role of roles) {
      const alpha = scrimAlphaFor(role, "both");
      for (const fond of fonds) {
        const rendu = compositeOver(GLASS_ROLE_COLORS[role.tone].surface, alpha, fond);
        expect(
          contrastRatio(GLASS_ROLE_COLORS[role.tone][role.role], rendu),
        ).toBeGreaterThanOrEqual(WCAG_AA);
      }
    }
  });

  it("n'a besoin d'aucune sous-couche quand le fond le plus défavorable est déjà lisible", () => {
    // Texte encre sur fond blanc : 0 % suffit.
    expect(scrimAlphaFor({ tone: "light", role: "text" }, "white")).toBe(0);
    // Texte clair sur fond noir : 0 % suffit.
    expect(scrimAlphaFor({ tone: "dark", role: "text" }, "black")).toBe(0);
    // Contre « both », il en faut forcément.
    expect(scrimAlphaFor({ tone: "light", role: "text" }, "both")).toBeGreaterThan(0.3);
  });

  it("accepte des couleurs explicites, un fond précis ou une liste, et un seuil différent", () => {
    const pair = { text: "#000000", scrim: "#FFFFFF" };
    expect(scrimAlphaFor(pair, "#000000")).toBe(scrimAlphaFor(pair, "black"));
    expect(scrimAlphaFor(pair, ["#000000", "#FFFFFF"])).toBe(scrimAlphaFor(pair, "both"));
    expect(scrimAlphaFor(pair, "black", 7)).toBeGreaterThan(scrimAlphaFor(pair, "black", WCAG_AA));
  });

  it("refuse un couple texte / surface qui ne tient pas le seuil même opaque", () => {
    expect(() => scrimAlphaFor({ text: "#999999", scrim: "#FFFFFF" })).toThrow(
      /Contraste impossible/,
    );
  });
});

describe("tokens du verre (tokens.css)", () => {
  it("le miroir GLASS_ROLE_COLORS suit les rôles de la charte en clair et en sombre", () => {
    expect(resolve("--surface").toUpperCase()).toBe(GLASS_ROLE_COLORS.light.surface);
    expect(resolve("--text").toUpperCase()).toBe(GLASS_ROLE_COLORS.light.text);
    expect(resolve("--text-muted").toUpperCase()).toBe(GLASS_ROLE_COLORS.light["text-muted"]);
    for (const dark of [darkForced, darkSystem]) {
      expect(resolve("--surface", dark).toUpperCase()).toBe(GLASS_ROLE_COLORS.dark.surface);
      expect(resolve("--text", dark).toUpperCase()).toBe(GLASS_ROLE_COLORS.dark.text);
      expect(resolve("--text-muted", dark).toUpperCase()).toBe(
        GLASS_ROLE_COLORS.dark["text-muted"],
      );
    }
    // Tons forcés : mêmes valeurs que les rôles.
    expect(resolve("--glass-light-surface").toUpperCase()).toBe(GLASS_ROLE_COLORS.light.surface);
    expect(resolve("--glass-light-text").toUpperCase()).toBe(GLASS_ROLE_COLORS.light.text);
    expect(resolve("--glass-dark-surface").toUpperCase()).toBe(GLASS_ROLE_COLORS.dark.surface);
    expect(resolve("--glass-dark-text").toUpperCase()).toBe(GLASS_ROLE_COLORS.dark.text);
  });

  it("déclare --glass-bg, --glass-border, --glass-highlight, --glass-shadow en clair et dans les deux blocs sombres", () => {
    for (const name of [
      "--glass-bg",
      "--glass-border",
      "--glass-highlight",
      "--glass-shadow",
      "--glass-scrim",
    ]) {
      expect(light.has(name), name).toBe(true);
    }
    expect(light.get("--glass-bg")).toMatch(
      /color-mix\(in srgb, var\(--surface\) var\(--glass-alpha\), transparent\)/,
    );
    for (const dark of [darkForced, darkSystem]) {
      for (const name of [
        "--glass-alpha",
        "--glass-border",
        "--glass-highlight",
        "--glass-shadow",
        "--glass-scrim",
      ]) {
        expect(dark.get(name), name).toMatch(/^var\(--glass-dark-/);
      }
    }
  });

  it("liseré clair : blanc entre 35 % et 55 % selon le thème", () => {
    for (const name of ["--glass-light-border", "--glass-dark-border"]) {
      const m = /color-mix\(in srgb, var\(--gray-0\) (\d+)%, transparent\)/.exec(resolve(name));
      expect(m, name).not.toBeNull();
      const pct = Number(m![1]);
      expect(pct).toBeGreaterThanOrEqual(35);
      expect(pct).toBeLessThanOrEqual(55);
    }
  });

  it("l'opacité de la sous-couche (--glass-*-scrim) couvre le minimum calculé pour 4,5:1 sur blanc et noir", () => {
    const lightScrim = percent(resolve("--glass-light-scrim"));
    const darkScrim = percent(resolve("--glass-dark-scrim"));
    expect(lightScrim).toBeGreaterThanOrEqual(scrimAlphaFor({ tone: "light", role: "text" }));
    expect(darkScrim).toBeGreaterThanOrEqual(scrimAlphaFor({ tone: "dark", role: "text" }));
    expect(scrimContrast({ tone: "light", role: "text" }, lightScrim)).toBeGreaterThanOrEqual(
      WCAG_AA,
    );
    expect(scrimContrast({ tone: "dark", role: "text" }, darkScrim)).toBeGreaterThanOrEqual(
      WCAG_AA,
    );
    // Le rôle « auto » pointe vers la bonne valeur selon le thème.
    expect(percent(resolve("--glass-scrim"))).toBe(lightScrim);
    expect(percent(resolve("--glass-scrim", darkForced))).toBe(darkScrim);
    expect(percent(resolve("--glass-scrim", darkSystem))).toBe(darkScrim);
  });
});

describe("rôles colorés dans le verre (accent, succès, erreur, avertissement)", () => {
  const glassCss = readFileSync(
    resolvePath(dirname(fileURLToPath(import.meta.url)), "../styles/glass.css"),
    "utf8",
  );
  const roles = ["accent", "success", "danger", "warning"] as const;
  const scrim = {
    light: () => percent(resolve("--glass-light-scrim")),
    dark: () => percent(resolve("--glass-dark-scrim")),
  };

  it.each(["light", "dark"] as const)(
    "%s : chaque variante « verre » tient 4,5:1 sur la sous-couche déclarée, sur blanc ET noir",
    (tone) => {
      for (const role of roles) {
        const text = GLASS_COLORED_ROLES[tone][role];
        const surface = GLASS_ROLE_COLORS[tone].surface;
        expect(scrimContrast({ text, scrim: surface }, scrim[tone](), "both"), `${tone}/${role}`).toBeGreaterThanOrEqual(WCAG_AA);
      }
    },
  );

  it("les rôles de la charte, eux, ne tiennent pas : c'est pour cela qu'ils sont remplacés dans le verre", () => {
    // Violet 600 (onglet actif du dock, clair) sur la seule sous-couche, photo noire dessous : environ 2:1.
    expect(scrimContrast({ text: "#6442D6", scrim: "#FFFFFF" }, scrim.light(), "black")).toBeLessThan(WCAG_AA);
    expect(scrimContrast({ text: "#1D7F4E", scrim: "#FFFFFF" }, scrim.light(), "black")).toBeLessThan(WCAG_AA);
    expect(scrimContrast({ text: "#B5A3FF", scrim: "#23202A" }, scrim.dark(), "white")).toBeLessThan(WCAG_AA);
  });

  it("tokens.css suit le miroir, et glass.css redéfinit les quatre rôles dans le contenu du verre", () => {
    for (const tone of ["light", "dark"] as const)
      for (const role of roles)
        expect(resolve(`--glass-${tone}-${role}`).toUpperCase(), `${tone}/${role}`).toBe(GLASS_COLORED_ROLES[tone][role]);
    for (const role of roles) {
      expect(resolve(`--glass-${role}`)).toBe(resolve(`--glass-light-${role}`));
      for (const dark of [darkForced, darkSystem]) expect(dark.get(`--glass-${role}`), role).toBe(`var(--glass-dark-${role})`);
    }
    const content = /\.glass-surface\[data-glass="glass"\] > \.glass-surface__content \{([\s\S]*?)\}/.exec(glassCss)?.[1] ?? "";
    for (const role of roles) expect(content, role).toMatch(new RegExp(`--${role}: var\\(--_glass-${role}\\)`));
    expect(content).toMatch(/--on-accent: var\(--_glass-surface\)/);
    // Aucune couleur hexadécimale dans glass.css : tout passe par les jetons.
    expect(glassCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
