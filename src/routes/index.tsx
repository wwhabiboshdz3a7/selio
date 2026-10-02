import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ListingCard, type ListingSummary } from "../components/listing/ListingCard";
import { FilterBar, type Filters } from "../components/listing/FilterBar";
import { HeroScene } from "../components/three/HeroScene";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  component: Index,
});

type ListingsResponse = { ok: boolean; items: ListingSummary[]; total: number };

async function fetchListings(params: URLSearchParams): Promise<ListingsResponse> {
  const res = await fetch(`/api/listings?${params.toString()}`);
  if (!res.ok) throw new Error("Impossible de charger les annonces");
  return res.json();
}

function Index() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({ category: "", condition: "", size: "", minPrice: "", maxPrice: "", sort: "pertinence" });

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (filters.category) p.set("category", filters.category);
    if (filters.condition) p.set("condition", filters.condition);
    if (filters.size) p.set("size", filters.size);
    if (filters.minPrice) p.set("minPrice", filters.minPrice);
    if (filters.maxPrice) p.set("maxPrice", filters.maxPrice);
    p.set("sort", filters.sort);
    return p;
  }, [q, filters]);

  const { data, isLoading, isError } = useQuery({ queryKey: ["listings", params.toString()], queryFn: () => fetchListings(params) });

  return (
    <div className="selio-container py-8">
      <section className="selio-hero-gradient relative mb-8 overflow-hidden rounded-3xl px-6 py-14 text-white sm:px-10 sm:py-20">
        <HeroScene className="pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative">
          <span className="selio-chip bg-white/15 text-white border-white/20 backdrop-blur">Mode de seconde main</span>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight sm:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
            Donnez une seconde vie a votre dressing
          </h1>
          <p className="mt-4 max-w-lg text-white/85">
            Achetez et vendez des vetements et accessoires de seconde main, selectionnes par une communaute qui aime la mode responsable.
          </p>
        </div>
      </section>

      {q && (
        <p className="mb-3 text-sm text-[var(--color-selio-text-muted)]">
          Resultats pour <strong>&laquo;&nbsp;{q}&nbsp;&raquo;</strong>{" "}
          <button className="ml-2 underline" onClick={() => navigate({ to: "/", search: {} })}>effacer</button>
        </p>
      )}

      <div className="mb-6"><FilterBar filters={filters} onChange={setFilters} /></div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-[var(--color-selio-surface)]" />)}
        </div>
      )}

      {isError && <p className="text-[var(--color-selio-danger)]">Erreur de chargement des annonces.</p>}
      {data && data.items.length === 0 && <p className="py-16 text-center text-[var(--color-selio-text-muted)]">Aucune annonce ne correspond a votre recherche pour le moment.</p>}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {data.items.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
        </div>
      )}
    </div>
  );
}
