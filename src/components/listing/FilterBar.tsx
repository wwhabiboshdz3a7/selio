import { CATEGORIES, CONDITIONS } from "../../lib/validation";
import { CATEGORY_LABELS, CONDITION_LABELS, SORT_LABELS } from "../../lib/format";

export type Filters = {
  category: string;
  condition: string;
  size: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
};

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="selio-card flex flex-wrap items-end gap-3 p-4">
      <div>
        <label className="selio-label">Categorie</label>
        <select className="selio-input" value={filters.category} onChange={(e) => set("category", e.target.value)}>
          <option value="">Toutes</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>
      <div>
        <label className="selio-label">Etat</label>
        <select className="selio-input" value={filters.condition} onChange={(e) => set("condition", e.target.value)}>
          <option value="">Tous</option>
          {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
        </select>
      </div>
      <div>
        <label className="selio-label">Taille</label>
        <input className="selio-input w-24" placeholder="M, 38..." value={filters.size} onChange={(e) => set("size", e.target.value)} />
      </div>
      <div>
        <label className="selio-label">Prix min (€)</label>
        <input type="number" min={0} className="selio-input w-24" value={filters.minPrice} onChange={(e) => set("minPrice", e.target.value)} />
      </div>
      <div>
        <label className="selio-label">Prix max (€)</label>
        <input type="number" min={0} className="selio-input w-24" value={filters.maxPrice} onChange={(e) => set("maxPrice", e.target.value)} />
      </div>
      <div className="ml-auto">
        <label className="selio-label" title="Pertinence = correspondance avec la recherche + fraicheur de l'annonce + nombre de favoris">Trier par</label>
        <select className="selio-input" value={filters.sort} onChange={(e) => set("sort", e.target.value)}>
          {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </div>
  );
}
