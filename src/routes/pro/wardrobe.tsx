import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "../../lib/format";

export const Route = createFileRoute("/pro/wardrobe")({ component: Wardrobe });

type Item = {
  id: string; title: string; brand: string | null; purchase_price_cents: number | null;
  purchase_date: string | null; category: string | null; status: string; notes: string | null;
};

async function fetchItems(): Promise<Item[]> {
  const res = await fetch("/api/pro/wardrobe", { credentials: "include" });
  const data = await res.json();
  return data.items ?? [];
}

const STATUS_LABELS: Record<string, string> = {
  in_stock: "En stock", listed: "En vente", sold: "Vendu", archived: "Archive",
};

function Wardrobe() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pro-wardrobe"], queryFn: fetchItems });
  const [form, setForm] = useState({ title: "", brand: "", purchasePriceCents: "", category: "", notes: "" });
  const [open, setOpen] = useState(false);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await fetch("/api/pro/wardrobe", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: form.title, brand: form.brand || undefined,
        purchasePriceCents: form.purchasePriceCents ? Math.round(Number(form.purchasePriceCents) * 100) : undefined,
        category: form.category || undefined, notes: form.notes || undefined,
      }),
    });
    setForm({ title: "", brand: "", purchasePriceCents: "", category: "", notes: "" });
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["pro-wardrobe"] });
  }

  async function updateStatus(id: string, status: string) {
    await fetch("/api/pro/wardrobe", {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    qc.invalidateQueries({ queryKey: ["pro-wardrobe"] });
  }

  async function removeItem(id: string) {
    await fetch(`/api/pro/wardrobe?id=${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["pro-wardrobe"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Dressing &amp; stock</h1>
          <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">Journal de ton inventaire, du premier achat a la vente.</p>
        </div>
        <button className="selio-btn selio-btn-primary" onClick={() => setOpen((v) => !v)} type="button">
          {open ? "Fermer" : "+ Ajouter un article"}
        </button>
      </div>

      {open && (
        <form onSubmit={addItem} className="selio-card-premium grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="selio-label">Titre</label>
            <input className="selio-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="selio-label">Marque</label>
            <input className="selio-input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
          <div>
            <label className="selio-label">Prix d&rsquo;achat (€)</label>
            <input type="number" step="0.01" className="selio-input" value={form.purchasePriceCents} onChange={(e) => setForm({ ...form, purchasePriceCents: e.target.value })} />
          </div>
          <div>
            <label className="selio-label">Categorie</label>
            <input className="selio-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="selio-label">Notes</label>
            <textarea className="selio-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="selio-btn selio-btn-primary">Enregistrer</button>
          </div>
        </form>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((item) => (
          <div key={item.id} className="selio-card-premium p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">{item.title}</p>
                {item.brand && <p className="text-xs text-[var(--color-selio-text-muted)]">{item.brand}</p>}
              </div>
              <span className="selio-chip">{STATUS_LABELS[item.status] ?? item.status}</span>
            </div>
            {item.purchase_price_cents != null && (
              <p className="mt-2 text-sm text-[var(--color-selio-text-muted)]">Achete {formatPrice(item.purchase_price_cents)}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <select className="selio-input !py-1 text-sm" value={item.status} onChange={(e) => updateStatus(item.id, e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="selio-btn selio-btn-outline !py-1 text-sm" onClick={() => removeItem(item.id)} type="button">Supprimer</button>
            </div>
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Dressing vide pour l&rsquo;instant.</p>}
      </div>
    </div>
  );
}
