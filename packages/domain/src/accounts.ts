import type { ConnectionUsage, MarketplaceConnection } from "@selio/contracts";

/**
 * Comptes connectés catégorisés (vente, achat, perso).
 * Règles pures partagées par le serveur, la démo et l'interface.
 */
type AccountLike = Pick<MarketplaceConnection, "id" | "usage" | "status" | "provider">;

const INACTIVE: ReadonlySet<MarketplaceConnection["status"]> = new Set(["disconnected", "unsupported"]);

/** Raison affichée quand une automatisation ignore un compte Perso. */
export const PERSONAL_ACCOUNT_SKIP = "Compte Perso : jamais utilisé par les automatisations";

/** Un compte Perso n'est jamais utilisé par une automatisation ni par l'achat automatique. */
export function isAutomatable(account: Pick<MarketplaceConnection, "usage"> | null | undefined): boolean {
  return account?.usage !== "personal";
}

export function isActiveAccount(account: Pick<MarketplaceConnection, "status">): boolean {
  return !INACTIVE.has(account.status);
}

/**
 * Compte « Achat » utilisé par les achats (validés ou automatiques) : celui choisi
 * s'il est toujours un compte Achat actif, sinon le premier compte Achat actif.
 * Jamais un compte Vente ou Perso.
 */
export function resolvePurchaseAccount<T extends AccountLike>(accounts: readonly T[], preferredId: string | null | undefined): T | null {
  const candidates = accounts.filter((a) => a.usage === "purchase" && isActiveAccount(a));
  return candidates.find((a) => a.id === preferredId) ?? candidates[0] ?? null;
}

/**
 * Comptes proposés pour publier une annonce : les comptes Vente d'abord (Vinted
 * avant le simulateur), puis les comptes Perso, signalés. Jamais un compte Achat.
 */
export function listingAccounts<T extends AccountLike>(accounts: readonly T[]): T[] {
  const rank = (a: T) => (a.usage === "sale" ? (a.provider === "vinted" ? 0 : 1) : 2);
  return accounts.filter((a) => a.usage !== "purchase" && isActiveAccount(a)).sort((a, b) => rank(a) - rank(b));
}

export function countByUsage(accounts: readonly Pick<MarketplaceConnection, "usage">[]): Record<ConnectionUsage | "all", number> {
  const out = { all: accounts.length, sale: 0, purchase: 0, personal: 0 };
  for (const a of accounts) out[a.usage]++;
  return out;
}

/** Le simulateur de démonstration n'est pas un vrai compte : il ne compte pas dans le quota. */
export function countsTowardQuota(account: Pick<MarketplaceConnection, "provider">): boolean {
  return account.provider !== "demo";
}

/** Chiffres utiles d'un compte (page Comptes Vinted). « Ce mois-ci » = depuis le 1er du mois (UTC), comme les analyses. */
export interface AccountStats {
  connectionId: string;
  /** Annonces en ligne (en vente ou réservées). */
  listedItems: number;
  salesThisMonth: number;
  revenueThisMonthCents: number;
  /** Achats effectués (simulés) avec ce compte. */
  purchases: number;
  purchasesSpentCents: number;
  openConversations: number;
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const DONE_PURCHASE = new Set(["simulated", "executed"]);
const VOID_ORDER = new Set(["cancelled", "refunded"]);

export function computeAccountStats(
  accounts: readonly Pick<MarketplaceConnection, "id">[],
  data: {
    items: readonly { connectionId: string | null; status: string }[];
    orders: readonly { connectionId: string | null; status: string; salePriceCents: number; createdAt: string }[];
    purchases: readonly { connectionId?: string | null; status: string; maxPriceCents: number }[];
    conversations: readonly { connectionId: string | null; status: string }[];
  },
  now: Date,
): AccountStats[] {
  const since = monthStart(now).getTime();
  return accounts.map((a) => {
    const orders = data.orders.filter((o) => o.connectionId === a.id && !VOID_ORDER.has(o.status) && new Date(o.createdAt).getTime() >= since);
    const purchases = data.purchases.filter((p) => p.connectionId === a.id && DONE_PURCHASE.has(p.status));
    return {
      connectionId: a.id,
      listedItems: data.items.filter((i) => i.connectionId === a.id && (i.status === "listed" || i.status === "reserved")).length,
      salesThisMonth: orders.length,
      revenueThisMonthCents: orders.reduce((s, o) => s + o.salePriceCents, 0),
      purchases: purchases.length,
      purchasesSpentCents: purchases.reduce((s, p) => s + p.maxPriceCents, 0),
      openConversations: data.conversations.filter((c) => c.connectionId === a.id && c.status === "open").length,
    };
  });
}
