import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { formatPrice, CONDITION_LABELS } from "../lib/format";

export const Route = createFileRoute("/account")({ component: Account });

type MyListing = { id: string; title: string; priceCents: number; condition: string; status: string; coverImageUrl: string | null };

async function fetchMine(): Promise<MyListing[]> {
  const res = await fetch("/api/listings?mine=1", { credentials: "include" });
  if (!res.ok) throw new Error("Erreur");
  const data = (await res.json()) as { items: MyListing[] };
  return data.items;
}

function Account() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: listings, isLoading } = useQuery({ queryKey: ["my-listings"], queryFn: fetchMine, enabled: !!user });

  async function markSold(id: string) {
    await fetch(`/api/listings/${id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "sold" }) });
    queryClient.invalidateQueries({ queryKey: ["my-listings"] });
  }

  async function archive(id: string) {
    await fetch(`/api/listings/${id}`, { method: "DELETE", credentials: "include" });
    queryClient.invalidateQueries({ queryKey: ["my-listings"] });
  }

  if (!userLoading && !user) {
    return (
      <div className="selio-container py-16 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Mon compte</h1>
        <Link to="/login" className="selio-btn selio-btn-primary mt-4 inline-flex">Se connecter</Link>
      </div>
    );
  }

  return (
    <div className="selio-container py-8">
      {user && (
        <div className="selio-card mb-8 p-5">
          <h1 className="text-xl font-semibold text-[var(--color-selio-primary-dark)]">{user.displayName}</h1>
          <p className="text-sm text-[var(--color-selio-text-muted)]">@{user.username} · {user.email}</p>
          <p className="mt-1 text-xs text-[var(--color-selio-text-muted)]">Membre depuis {new Date(user.createdAt).toLocaleDateString("fr-FR")}</p>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-selio-primary-dark)]">Mes annonces</h2>
        <Link to="/sell" className="selio-btn selio-btn-primary">+ Nouvelle annonce</Link>
      </div>

      {isLoading && <p className="text-[var(--color-selio-text-muted)]">Chargement...</p>}
      {listings && listings.length === 0 && <p className="text-[var(--color-selio-text-muted)]">Vous n&rsquo;avez pas encore d&rsquo;annonce.</p>}

      <div className="space-y-3">
        {listings?.map((l) => (
          <div key={l.id} className="selio-card flex items-center gap-4 p-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--color-selio-surface)]">
              {l.coverImageUrl && <img src={l.coverImageUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <Link to="/listing/$id" params={{ id: l.id }} className="truncate font-medium hover:underline">{l.title}</Link>
              <p className="text-sm text-[var(--color-selio-text-muted)]">
                {formatPrice(l.priceCents)} · {CONDITION_LABELS[l.condition] ?? l.condition} ·{" "}
                <span className="font-medium">{l.status === "active" ? "En vente" : l.status === "sold" ? "Vendue" : "Archivee"}</span>
              </p>
            </div>
            {l.status === "active" && (
              <>
                <button className="selio-btn selio-btn-outline" onClick={() => markSold(l.id)} type="button">Marquer vendue</button>
                <button className="selio-btn selio-btn-outline" onClick={() => archive(l.id)} type="button">Archiver</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
