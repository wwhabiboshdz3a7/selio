import { z } from "zod";

/** Question posée à l'assistant d'aide (texte libre, donnée non fiable). */
export const helpAskInput = z.object({
  question: z.string().trim().min(3, "Posez une question d'au moins trois caractères.").max(500, "Question trop longue (500 caractères au plus)."),
});
export type HelpAskInput = z.infer<typeof helpAskInput>;

/** Une question de la FAQ citée comme source d'une réponse. */
export const helpSource = z.object({
  id: z.string().max(80),
  question: z.string().max(300),
  categoryId: z.string().max(40),
  categoryTitle: z.string().max(120),
});
export type HelpSource = z.infer<typeof helpSource>;

/**
 * Réponse de l'assistant d'aide.
 * - source « ai » : rédigée par l'IA à partir des passages de la FAQ retenus (mode connecté) ;
 * - source « faq » : tirée directement de la FAQ par la recherche locale (vitrine, démonstration,
 *   ou repli quand l'IA est indisponible, désactivée ou que sa sortie est écartée).
 */
export const helpAnswer = z.object({
  question: z.string(),
  answer: z.string(),
  /** Au moins un passage de la FAQ correspond à la question. */
  found: z.boolean(),
  source: z.enum(["ai", "faq"]),
  sources: z.array(helpSource).max(5),
  /** Démonstration : aucune IA réelle, la réponse est tirée de la FAQ. */
  simulated: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Pourquoi l'IA n'a pas rédigé la réponse (null si elle l'a fait). */
  fallbackReason: z.string().nullable(),
});
export type HelpAnswer = z.infer<typeof helpAnswer>;
