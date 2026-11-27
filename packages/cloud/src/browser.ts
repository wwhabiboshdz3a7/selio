import type { CapturedConversation } from "@selio/connectors/vinted-adapter";

/**
 * Partie du socle Cloud utilisable DANS UN NAVIGATEUR (extension Selio, automatisation complète, D64) :
 * aucune dépendance à Node ni à Playwright. Même détection des signaux de Vinted (`detectBlock`, pour
 * s'arrêter, jamais pour contourner), mêmes repères du bouton d'envoi et même confirmation d'envoi que
 * l'exécuteur du Cloud : le comportement est identique dans les deux modes.
 */
export { detectBlock, BLOCK_CODES, BLOCK_MESSAGES, type BlockCode, type BlockSignal, type DetectOptions } from "./guard";
export { SEND_BUTTON_IN_FORM, SEND_BUTTON_NAME, isLoginPath } from "./vinted";

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Nombre de messages sortants dont le corps est le texte envoyé (confirmation d'un envoi). */
export function countSentCopies(conversation: Pick<CapturedConversation, "messages"> | null, text: string): number {
  if (!conversation) return 0;
  const wanted = collapse(text);
  return conversation.messages.filter((m) => m.direction === "outbound" && collapse(m.body) === wanted).length;
}
