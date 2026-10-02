import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { ListingCard, type ListingSummary } from "../components/listing/ListingCard";

export const Route = createFileRoute("/favorites")({ component: Favorites });

async function fetchFavorites(): Promise<ListingSummary[]> {
  const res = await fetch("/api/favorites", { credentials: "include" });
  if (!res.ok) throw new Error("Erreur");
  const data = (await res.json()) as { items: ListingSummary[] };
  return data.items;
}

function Favorites() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data, isLoading } = useQuery({ queryKey: ["favorites"], queryFn: fetchFavorites, enabled: !!user });

  if (!userLoading && !user) {
    return (
      <div className="selio-container py-16 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Vos favoris</h1>
        <p className="mt-2 text-[var(--color-selio-text-muted)]">Connectez-vous pour retrouver vos articles favoris.</p>
        <Link to="/login" className="selio-btn selio-btn-primary mt-4 inline-flex">Se connecter</Link>
      </div>
    );
  }

  return (
    <div className="selio-container py-8">
      <h1 className="mb-6 text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Vos favoris</h1>
      {isLoading && <p className="text-[var(--color-selio-text-muted)]">Chargement...</p>}
      {data && data.length === 0 && <p className="text-[var(--color-selio-text-muted)]">Aucun favori pour le moment.</p>}
      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {data.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
        </div>
      )}
    </div>
  );
}
