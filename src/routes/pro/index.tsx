import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatPrice } from "../../lib/format";

export const Route = createFileRoute("/pro/")({ component: ProOverview });

type Sale = { sale_price_cents: number; purchase_price_cents: number; platform_fee_cents: number; shipping_cost_cents: number };
type WardrobeItem = { status: string };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur");
  return res.json();
}

function ProOverview() {
  const { data: sales } = useQuery({ queryKey: ["pro-sales"], queryFn: () => fetchJson<{ items: Sale[] }>("/api/pro/sales") });
  const { data: wardrobe } = useQuery({ queryKey: ["pro-wardrobe"], queryFn: () => fetchJson<{ items: WardrobeItem[] }>("/api/pro/wardrobe") });
  const { data: rules } = useQuery({ queryKey: ["pro-rules"], queryFn: () => fetchJson<{ rules: unknown[] }>("/api/pro/automation/rules") });

  const salesItems = sales?.items ?? [];
  const totalRevenue = salesItems.reduce((s, x) => s + x.sale_price_cents, 0);
  const totalMargin = salesItems.reduce((s, x) => s + x.sale_price_cents - x.purchase_price_cents - x.platform_fee_cents - x.shipping_cost_cents, 0);
  const inStock = (wardrobe?.items ?? []).filter((w) => w.status === "in_stock").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Vue d&rsquo;ensemble</h1>
        <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">Le centre de pilotage de ton activite de revente.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Ventes</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{salesItems.length}</p></div>
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Chiffre d&rsquo;affaires</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{formatPrice(totalRevenue)}</p></div>
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Marge nette</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{formatPrice(totalMargin)}</p></div>
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Articles en stock</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{inStock}</p></div>
      </div>

      <div className="selio-card-premium p-5">
        <h2 className="font-semibold text-[var(--color-selio-primary-dark)]">Automatisations actives</h2>
        <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">
          {rules?.rules.length ?? 0} regle(s) configuree(s). Elles s&rsquo;executent automatiquement toutes les 15 minutes
          sur ton activite Selio (favoris, messages, ventes).
        </p>
        <Link to="/pro/automation" className="selio-btn selio-btn-outline mt-3 inline-flex">Gerer les automatisations</Link>
      </div>

      <div className="selio-card-premium p-5">
        <h2 className="font-semibold text-[var(--color-selio-primary-dark)]">Comptes Vinted</h2>
        <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">
          Vinted ne propose pas d&rsquo;API publique pour les vendeurs : la connexion automatique n&rsquo;est pas disponible
          pour l&rsquo;instant. Tu peux deja centraliser ton suivi ici (dressing, ventes, compta) en attendant.
        </p>
        <Link to="/pro/accounts" className="selio-btn selio-btn-outline mt-3 inline-flex">Voir mes comptes</Link>
      </div>
    </div>
  );
}
