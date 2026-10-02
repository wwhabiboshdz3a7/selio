import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "../../lib/format";

export const Route = createFileRoute("/pro/sales")({ component: Sales });

type Sale = {
  id: string; sale_price_cents: number; platform_fee_cents: number; shipping_cost_cents: number;
  purchase_price_cents: number; sold_at: string; buyer_username: string | null;
};

async function fetchSales(): Promise<Sale[]> {
  const res = await fetch("/api/pro/sales", { credentials: "include" });
  const data = await res.json();
  return data.items ?? [];
}

function toCents(v: string) {
  return v ? Math.round(Number(v) * 100) : 0;
}

function Sales() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pro-sales"], queryFn: fetchSales });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", salePrice: "", fees: "", shipping: "", purchase: "", buyer: "" });

  async function addSale(e: React.FormEvent) {
    e.preventDefault();
    if (!form.salePrice || !form.title.trim()) return;
    await fetch("/api/pro/sales", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        salePriceCents: toCents(form.salePrice),
        platformFeeCents: toCents(form.fees),
        shippingCostCents: toCents(form.shipping),
        purchasePriceCents: toCents(form.purchase),
        buyerUsername: form.buyer || undefined,
      }),
    });
    setForm({ title: "", salePrice: "", fees: "", shipping: "", purchase: "", buyer: "" });
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["pro-sales"] });
  }

  const items = data ?? [];
  const totalRevenue = items.reduce((s, x) => s + x.sale_price_cents, 0);
  const totalMargin = items.reduce((s, x) => s + x.sale_price_cents - x.purchase_price_cents - x.platform_fee_cents - x.shipping_cost_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Ventes &amp; comptabilite</h1>
          <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">Suivi de tes ventes et export comptable.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/pro/sales/export" className="selio-btn selio-btn-outline">Exporter XLSX</a>
          <button className="selio-btn selio-btn-primary" onClick={() => setOpen((v) => !v)} type="button">
            {open ? "Fermer" : "+ Nouvelle vente"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Ventes</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{items.length}</p></div>
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Chiffre d&rsquo;affaires</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{formatPrice(totalRevenue)}</p></div>
        <div className="selio-stat"><p className="text-xs text-[var(--color-selio-text-muted)]">Marge nette</p><p className="mt-1 text-xl font-bold text-[var(--color-selio-primary-dark)]">{formatPrice(totalMargin)}</p></div>
      </div>

      {open && (
        <form onSubmit={addSale} className="selio-card-premium grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="selio-label">Prix de vente (€)</label>
            <input type="number" step="0.01" required className="selio-input" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
          </div>
          <div>
            <label className="selio-label">Frais plateforme (€)</label>
            <input type="number" step="0.01" className="selio-input" value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} />
          </div>
          <div>
            <label className="selio-label">Frais de port (€)</label>
            <input type="number" step="0.01" className="selio-input" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} />
          </div>
          <div>
            <label className="selio-label">Prix d&rsquo;achat (€)</label>
            <input type="number" step="0.01" className="selio-input" value={form.purchase} onChange={(e) => setForm({ ...form, purchase: e.target.value })} />
          </div>
          <div className="lg:col-span-2">
            <label className="selio-label">Acheteur (optionnel)</label>
            <input className="selio-input" value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} />
          </div>
          <div className="lg:col-span-4">
            <button type="submit" className="selio-btn selio-btn-primary">Enregistrer la vente</button>
          </div>
        </form>
      )}

      <div className="selio-card-premium overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-selio-border)] text-left text-[var(--color-selio-text-muted)]">
              <th className="p-3">Date</th><th className="p-3">Acheteur</th><th className="p-3">Vente</th>
              <th className="p-3">Frais</th><th className="p-3">Port</th><th className="p-3">Achat</th><th className="p-3">Marge</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const margin = s.sale_price_cents - s.purchase_price_cents - s.platform_fee_cents - s.shipping_cost_cents;
              return (
                <tr key={s.id} className="border-b border-[var(--color-selio-border)] last:border-0">
                  <td className="p-3">{new Date(s.sold_at).toLocaleDateString("fr-FR")}</td>
                  <td className="p-3">{s.buyer_username ?? "—"}</td>
                  <td className="p-3">{formatPrice(s.sale_price_cents)}</td>
                  <td className="p-3">{formatPrice(s.platform_fee_cents)}</td>
                  <td className="p-3">{formatPrice(s.shipping_cost_cents)}</td>
                  <td className="p-3">{formatPrice(s.purchase_price_cents)}</td>
                  <td className="p-3 font-medium">{formatPrice(margin)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {items.length === 0 && <p className="p-4 text-sm text-[var(--color-selio-text-muted)]">Aucune vente enregistree.</p>}
      </div>
    </div>
  );
}
