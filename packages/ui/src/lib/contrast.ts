/* Contraste WCAG 2.x : fonctions pures, sans DOM. Elles servent aux tests qui
   vérifient que les couples texte / fond de tokens.css tiennent le niveau AA. */

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

/** Blanc pur et noir pur. */
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
