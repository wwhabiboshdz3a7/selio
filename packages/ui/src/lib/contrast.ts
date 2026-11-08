/* Contraste WCAG 2.x et calcul de la sous-couche (« scrim ») du verre liquide.

   Fonctions pures, sans DOM : elles servent aux tests (vérification des tokens de
   tokens.css) et à quiconque veut savoir quelle opacité minimale garantit un texte
   lisible sur une surface translucide posée sur un fond inconnu. */

/** Couleur sRGB 8 bits par canal. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Couleur acceptée : objet Rgb ou notation hexadécimale (#rgb ou #rrggbb). */
export type ColorInput = Rgb | string;

/** Seuil WCAG AA pour un texte courant. */
export const WCAG_AA = 4.5;

/** Les deux extrêmes possibles derrière un verre : blanc pur et noir pur. */
export const WHITE_RGB: Rgb = { r: 255, g: 255, b: 255 };
export const BLACK_RGB: Rgb = { r: 0, g: 0, b: 0 };

/** Lit une couleur hexadécimale (#rgb ou #rrggbb). Lève une erreur si la notation est invalide. */
export function parseHexColor(input: ColorInput): Rgb {
  if (typeof input !== "string") return input;
  const raw = input.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Couleur invalide : « ${input} »`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG (0 = noir, 1 = blanc). */
export function relativeLuminance(color: ColorInput): number {
  const { r, g, b } = parseHexColor(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapport de contraste WCAG entre deux couleurs opaques (de 1 à 21). */
export function contrastRatio(a: ColorInput, b: ColorInput): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Couleur obtenue en posant `top` avec l'opacité `alpha` sur `bottom` (mélange sRGB, comme le navigateur). */
export function compositeOver(top: ColorInput, alpha: number, bottom: ColorInput): Rgb {
  const t = parseHexColor(top);
  const u = parseHexColor(bottom);
  const a = Math.min(1, Math.max(0, alpha));
  const mix = (x: number, y: number) => x * a + y * (1 - a);
  return { r: mix(t.r, u.r), g: mix(t.g, u.g), b: mix(t.b, u.b) };
}

/* ---- Rôles de texte du verre ------------------------------------------- */

export type GlassRoleTone = "light" | "dark";
export type GlassTextRoleName = "text" | "text-muted";

/** Rôle de texte : la couleur du texte et celle de la sous-couche qui le porte. */
export interface GlassTextColors {
  text: ColorInput;
  scrim: ColorInput;
}

/**
 * Miroir des rôles de tokens.css utilisés par le verre (`--surface`, `--text`,
 * `--text-muted` en clair et en sombre). Un test relit tokens.css et vérifie que
 * ces valeurs n'ont pas dérivé ; aucun composant ne doit les utiliser pour peindre.
 */
export const GLASS_ROLE_COLORS: Record<
  GlassRoleTone,
  { surface: string } & Record<GlassTextRoleName, string>
> = {
  light: { surface: "#FFFFFF", text: "#1C1A24", "text-muted": "#6E6A7B" },
  dark: { surface: "#23202A", text: "#EEEBF3", "text-muted": "#B4AFC0" },
};

/** Rôles colorés redéfinis à l'intérieur du verre (texte d'accent, de succès, d'erreur, d'avertissement). */
export type GlassColoredRoleName = "accent" | "success" | "danger" | "warning";

/**
 * Miroir des variantes « verre » des rôles colorés (tokens.css : --glass-light-accent… / --glass-dark-accent…).
 * Sur la sous-couche du verre, les rôles de la charte (#6442D6, vert 600, rouge 600…) tombent sous 4,5:1 quand
 * un fond sombre passe dessous (environ 2:1 pour le violet 600 sur la seule sous-couche) : glass.css les
 * remplace, dans le contenu du verre, par ces variantes calculées pour tenir 4,5:1 sur blanc ET noir avec
 * l'opacité de sous-couche déclarée (--glass-*-scrim). Un test relit tokens.css et les recalcule.
 */
export const GLASS_COLORED_ROLES: Record<GlassRoleTone, Record<GlassColoredRoleName, string>> = {
  light: { accent: "#29195C", success: "#052815", danger: "#470D08", warning: "#3A2002" },
  dark: { accent: "#ECE6FF", success: "#D3F5E3", danger: "#FFE0DB", warning: "#FCE7C4" },
};

/** Rôle désigné par son nom et son ton (`{ tone: "dark", role: "text" }`) ou par ses couleurs. */
export type GlassTextRole = { tone: GlassRoleTone; role: GlassTextRoleName } | GlassTextColors;

/** Fond le plus défavorable : « both » = blanc ET noir, sinon une couleur précise ou une liste. */
export type WorstBackground = "white" | "black" | "both" | ColorInput | readonly ColorInput[];

function resolveRole(role: GlassTextRole): { text: Rgb; scrim: Rgb } {
  if ("tone" in role) {
    const palette = GLASS_ROLE_COLORS[role.tone];
    return { text: parseHexColor(palette[role.role]), scrim: parseHexColor(palette.surface) };
  }
  return { text: parseHexColor(role.text), scrim: parseHexColor(role.scrim) };
}

function resolveBackgrounds(worst: WorstBackground): Rgb[] {
  if (worst === "both") return [WHITE_RGB, BLACK_RGB];
  if (worst === "white") return [WHITE_RGB];
  if (worst === "black") return [BLACK_RGB];
  if (Array.isArray(worst)) return worst.map((c) => parseHexColor(c as ColorInput));
  return [parseHexColor(worst as ColorInput)];
}

/** Pas de recherche : un millième d'opacité. */
const STEPS = 1000;

/**
 * Opacité minimale (0 à 1, arrondie au centième supérieur) de la sous-couche pour que
 * le texte du rôle atteigne `target` (4,5:1 par défaut) quel que soit le fond le plus
 * défavorable. Par défaut, le fond est inconnu : on exige le seuil contre le blanc ET
 * contre le noir, ce qui couvre n'importe quel fond (chaque canal est compris entre les deux).
 *
 * La valeur renvoyée est sûre « vers le haut » : toute opacité supérieure respecte aussi le seuil.
 * Lève une erreur si même une sous-couche opaque ne suffit pas (couple texte/surface trop faible).
 */
export function scrimAlphaFor(
  textRole: GlassTextRole,
  worstBackground: WorstBackground = "both",
  target: number = WCAG_AA,
): number {
  const { text, scrim } = resolveRole(textRole);
  const backgrounds = resolveBackgrounds(worstBackground);
  const passes = (alpha: number) =>
    backgrounds.every((bg) => contrastRatio(text, compositeOver(scrim, alpha, bg)) >= target);

  if (!passes(1)) {
    throw new Error(
      `Contraste impossible : même opaque, la sous-couche donne ${contrastRatio(text, scrim).toFixed(2)}:1 (< ${target}:1).`,
    );
  }
  // On remonte depuis l'opacité pleine : la plus petite opacité dont toutes les opacités
  // supérieures passent (robuste même si le contraste n'est pas monotone sur un fond coloré).
  let lowest = STEPS;
  for (let i = STEPS - 1; i >= 0; i--) {
    if (!passes(i / STEPS)) break;
    lowest = i;
  }
  return Math.ceil(lowest / 10) / 100;
}

/** Contraste effectif du rôle sur la sous-couche d'opacité `alpha`, contre le pire des fonds donnés. */
export function scrimContrast(
  textRole: GlassTextRole,
  alpha: number,
  worstBackground: WorstBackground = "both",
): number {
  const { text, scrim } = resolveRole(textRole);
  return Math.min(
    ...resolveBackgrounds(worstBackground).map((bg) =>
      contrastRatio(text, compositeOver(scrim, alpha, bg)),
    ),
  );
}
