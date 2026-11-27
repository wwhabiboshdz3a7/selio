import { isSupportedUrl } from "../shared/messages";

/** Ce que le service worker sait de l'expéditeur d'un message (sous-ensemble de chrome.runtime.MessageSender). */
export interface SenderInfo {
  id?: string;
  url?: string;
  tab?: { url?: string } | undefined;
}

/**
 * Qui a le droit d'envoyer quoi au service worker.
 * - Messages des scripts de page (capture, règles…) : uniquement depuis un onglet Vinted pris en charge.
 * - Messages des pages de l'extension (popup, options : association du jeton…) : uniquement depuis une page
 *   servie par l'extension elle-même. La page d'options s'ouvre DANS UN ONGLET (`options_page`) : la présence
 *   d'un onglet ne suffit donc pas à la refuser, c'est l'adresse de la page qui fait foi. Un script de page
 *   Vinted a pour adresse celle de Vinted : il ne peut jamais se faire passer pour une page de l'extension.
 */
export function senderAllowed(sender: SenderInfo, requireSupportedTab: boolean, ext: { id: string; baseUrl: string }): boolean {
  if (sender.id !== ext.id) return false;
  const fromExtensionPage = Boolean(sender.url?.startsWith(ext.baseUrl));
  if (requireSupportedTab) return !fromExtensionPage && Boolean(sender.tab && isSupportedUrl(sender.tab.url ?? sender.url));
  return fromExtensionPage;
}
