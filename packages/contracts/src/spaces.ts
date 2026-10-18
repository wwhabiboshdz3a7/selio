import { z } from "zod";
import { isoDate } from "./common";

/**
 * Espaces Selio : l'outil de gestion (Selio) et les espaces qui s'appuient
 * sur ses données (Studio, Agence, Global). Seule la marque blanche de
 * Selio Agents (aperçu) a une donnée propre, enregistrée en démonstration.
 */

/** Couleurs d'accent proposées pour la marque blanche : toutes issues de la charte (jamais une couleur libre). */
export const WHITE_LABEL_ACCENTS = ["amethyste", "pervenche", "jade", "orchidee", "acier", "champagne", "encre"] as const;
export const whiteLabelAccent = z.enum(WHITE_LABEL_ACCENTS);
export type WhiteLabelAccent = z.infer<typeof whiteLabelAccent>;

export const WHITE_LABEL_ACCENT_LABELS: Record<WhiteLabelAccent, string> = {
  amethyste: "Améthyste",
  pervenche: "Pervenche",
  jade: "Jade",
  orchidee: "Orchidée",
  acier: "Acier",
  champagne: "Champagne",
  encre: "Encre",
};

export const whiteLabelInput = z.object({
  /** Nom affiché à la place de « Selio » dans l'outil de l'agence. */
  name: z.string().trim().min(2, "Au moins 2 caractères").max(40),
  /** Logo texte : 1 à 3 lettres ou chiffres. */
  initials: z.string().trim().toUpperCase().min(1, "1 à 3 caractères").max(3, "1 à 3 caractères").regex(/^[\p{L}\p{N}&]+$/u, "Lettres ou chiffres uniquement"),
  accent: whiteLabelAccent.default("amethyste"),
  /** Phrase d'accueil de l'écran de connexion. */
  tagline: z.string().trim().max(80).default(""),
  /** Mention « Propulsé par Selio » en pied d'écran. */
  poweredBy: z.boolean().default(true),
});
export type WhiteLabelInput = z.input<typeof whiteLabelInput>;

export const whiteLabel = whiteLabelInput.extend({ updatedAt: isoDate });
export type WhiteLabel = z.infer<typeof whiteLabel>;
