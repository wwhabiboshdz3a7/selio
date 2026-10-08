import { z } from "zod";

/**
 * Contrat de messages entre content script, popup/options et service worker.
 * Tout message est validé par schéma côté récepteur ; l'expéditeur est vérifié
 * (chrome.runtime.id, onglet d'un hôte pris en charge). Aucun secret ne transite
 * vers la page : seuls le service worker et les pages de l'extension voient le jeton.
 */
export const SUPPORTED_HOSTS = ["www.vinted.fr", "www.vinted.be", "www.vinted.com"];

export const capturedItem = z.object({
  externalRef: z.string().max(120).nullable(),
  url: z.string().url().max(500),
  title: z.string().min(1).max(200),
  brand: z.string().max(80).nullable(),
  size: z.string().max(40).nullable(),
  condition: z.enum(["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"]).nullable(),
  priceCents: z.number().int().min(0).nullable(),
  description: z.string().max(2000),
  photoUrls: z.array(z.string().url().max(500)).max(12),
  sellerHandle: z.string().max(80).nullable(),
});
export type CapturedItem = z.infer<typeof capturedItem>;

export const capturedConversation = z.object({
  externalRef: z.string().max(120).nullable(),
  url: z.string().url().max(500),
  buyerHandle: z.string().max(80).nullable(),
  itemTitle: z.string().max(200).nullable(),
  itemPriceCents: z.number().int().min(0).nullable(),
  messages: z.array(z.object({ direction: z.enum(["inbound", "outbound"]), body: z.string().max(2000), at: z.string().nullable() })).max(30),
  composerFound: z.boolean(),
});
export type CapturedConversation = z.infer<typeof capturedConversation>;

export const toBackground = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status") }),
  z.object({ type: z.literal("capture"), item: capturedItem, adapterVersion: z.string().max(40), purchasePriceCents: z.number().int().min(0).nullable() }),
  z.object({ type: z.literal("rules"), externalRef: z.string().max(120).nullable(), listedPriceCents: z.number().int().min(0).nullable(), offerCents: z.number().int().min(0).nullable() }),
  z.object({ type: z.literal("draft"), conversation: capturedConversation, itemExternalRef: z.string().max(120).nullable(), adapterVersion: z.string().max(40) }),
  z.object({ type: z.literal("diagnostic"), report: z.object({ url: z.string().max(500), pageKind: z.string().max(20), adapterVersion: z.string().max(40), ok: z.boolean(), missing: z.array(z.string().max(40)), warnings: z.array(z.string().max(200)), at: z.string() }) }),
  z.object({ type: z.literal("pair"), apiBaseUrl: z.string().url().max(300).refine((u) => /^https?:\/\//i.test(u), "URL http(s) requise"), token: z.string().min(20).max(200) }),
  z.object({ type: z.literal("unpair") }),
  z.object({ type: z.literal("getDiagnostics") }),
]);
export type ToBackground = z.infer<typeof toBackground>;

export interface ExtensionStatus {
  paired: boolean;
  apiBaseUrl: string | null;
  orgName: string | null;
  scopes: string[];
  lastPingAt: string | null;
  lastError: string | null;
}

export type BackgroundResponse =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

/** Messages du popup vers le content script de l'onglet actif. */
export const toContent = z.discriminatedUnion("type", [z.object({ type: z.literal("runDiagnostic") }), z.object({ type: z.literal("togglePanel") })]);
export type ToContent = z.infer<typeof toContent>;

export function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return SUPPORTED_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
