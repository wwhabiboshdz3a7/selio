import type { Customer, InventoryItem } from "@selio/contracts";
import { repos } from "@selio/db";
import { isAutomatable, suggestBundles as suggestBundlesPolicy, type BundleSuggestion, type BuyerInterest } from "@selio/domain";
import { requireAction, withOrg, type OrgContext } from "../context";

/**
 * Lots intelligents (§5.14) : propositions de lots calculées à la demande à partir du stock en ligne et
 * des conversations ouvertes (même acheteur intéressé par plusieurs articles, même marque et taille,
 * articles anciens). Les remises sont celles des réglages de négociation et ne descendent jamais sous le
 * plancher de lot (somme des planchers réels) : la proposition et l'évaluation d'une offre de lot
 * partagent la même borne (`lotFloorCents`). Rien n'est envoyé ni publié : le vendeur décide.
 */
export interface BundleSuggestionView extends BundleSuggestion {
  items: Pick<InventoryItem, "id" | "title" | "brand" | "size" | "listedPriceCents" | "photos">[];
  customer: Pick<Customer, "id" | "displayName"> | null;
  /** Conversation ouverte avec cet acheteur (pour lui proposer le lot) ; null : texte à copier. */
  conversationId: string | null;
}

export interface BundleSuggestionsView {
  enabled: boolean;
  suggestions: BundleSuggestionView[];
}

export function suggestBundles(ctx: OrgContext): Promise<BundleSuggestionsView> {
  requireAction(ctx, "items.read");
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const items = await repos.items.all(tx);
    // « Même acheteur » : par acheteur ET par compte Vinted (un lot ne réunit jamais deux vendeurs), jamais
    // depuis un compte Perso ; conversations les plus récentes d'abord.
    const personal = new Set((await repos.connections.list(tx)).filter((c) => !isAutomatable(c)).map((c) => c.id));
    const open = (await repos.conversations.open(tx))
      .filter((c) => !(c.connectionId && personal.has(c.connectionId)))
      .sort((a, b) => String(b.lastMessageAt ?? b.createdAt).localeCompare(String(a.lastMessageAt ?? a.createdAt)));
    const byCustomer = new Map<string, { customerId: string; ids: Set<string> }>();
    for (const c of open) {
      if (!c.itemId) continue;
      const key = `${c.customerId}|${c.connectionId ?? ""}`;
      const group = byCustomer.get(key) ?? { customerId: c.customerId, ids: new Set<string>() };
      group.ids.add(c.itemId);
      byCustomer.set(key, group);
    }
    const buyerInterest: BuyerInterest[] = [...byCustomer.values()].map((g) => ({ customerId: g.customerId, itemIds: [...g.ids] }));
    // Conversation où proposer le lot : la plus récente de cet acheteur sur un article du lot.
    const conversationFor = (s: BundleSuggestion) => (s.customerId ? open.find((c) => c.customerId === s.customerId && c.itemId !== null && s.itemIds.includes(c.itemId))?.id ?? null : null);
    const suggestions = suggestBundlesPolicy({ items, signals: { buyerInterest }, negotiation: org.settings.automation.negotiation, rules: org.settings.margin, settings: org.settings.bundles, now: ctx.services.now() });
    const byId = new Map(items.map((i) => [i.id, i]));
    const customers = new Map<string, Pick<Customer, "id" | "displayName">>();
    for (const s of suggestions) {
      if (!s.customerId || customers.has(s.customerId)) continue;
      const c = await repos.customers.byId(tx, s.customerId).catch(() => null);
      if (c) customers.set(c.id, { id: c.id, displayName: c.displayName });
    }
    return {
      enabled: org.settings.bundles.enabled,
      suggestions: suggestions.map((s) => ({
        ...s,
        items: s.itemIds.map((id) => byId.get(id)).filter((i) => i !== undefined).map((i) => ({ id: i.id, title: i.title, brand: i.brand, size: i.size, listedPriceCents: i.listedPriceCents, photos: i.photos.slice(0, 1) })),
        customer: s.customerId ? customers.get(s.customerId) ?? null : null,
        conversationId: conversationFor(s),
      })),
    };
  });
}
