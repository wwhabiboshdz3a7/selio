import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { formatPrice, CATEGORY_LABELS, CONDITION_LABELS } from "../lib/format";

export const Route = createFileRoute("/listing/$id")({ component: ListingDetail });

type ListingDetailData = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  size: string | null;
  condition: string;
  status: string;
  viewsCount: number;
  favoritesCount: number;
  createdAt: string;
  sellerId: string;
  seller: { username: string; displayName: string; bio: string | null; memberSince: string };
  images: string[];
};

async function fetchListing(id: string): Promise<ListingDetailData> {
  const res = await fetch(`/api/listings/${id}`);
  if (!res.ok) throw new Error("Annonce introuvable");
  const data = (await res.json()) as { listing: ListingDetailData };
  return data.listing;
}

function ListingDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [activeImage, setActiveImage] = useState(0);
  const [message, setMessage] = useState("Bonjour, cet article est-il toujours disponible ?");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [favorited, setFavorited] = useState<boolean | null>(null);

  const { data: listing, isLoading, isError } = useQuery({ queryKey: ["listing", id], queryFn: () => fetchListing(id) });

  async function toggleFavorite() {
    if (!user) { navigate({ to: "/login" }); return; }
    setFavBusy(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: id }),
      });
      const data = (await res.json()) as { favorited: boolean };
      setFavorited(data.favorited);
    } finally {
      setFavBusy(false);
    }
  }

  async function contactSeller(e: React.FormEvent) {
    e.preventDefault();
    if (!user) { navigate({ to: "/login" }); return; }
    setSending(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: id, message }),
      });
      if (res.ok) {
        const data = (await res.json()) as { conversationId: string };
        setSent(true);
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        navigate({ to: "/messages/$id", params: { id: data.conversationId } });
      }
    } finally {
      setSending(false);
    }
  }

  if (isLoading) return <div className="selio-container py-16 text-center text-[var(--color-selio-text-muted)]">Chargement...</div>;
  if (isError || !listing) return <div className="selio-container py-16 text-center text-[var(--color-selio-danger)]">Annonce introuvable.</div>;

  const isOwner = user?.id === listing.sellerId;

  return (
    <div className="selio-container py-8">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-xl bg-[var(--color-selio-surface)]">
            {listing.images[activeImage] ? (
              <img src={listing.images[activeImage]} alt={listing.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[var(--color-selio-text-muted)]">Pas de photo</div>
            )}
          </div>
          {listing.images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {listing.images.map((img, i) => (
                <button key={img} onClick={() => setActiveImage(i)} className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${i === activeImage ? "border-[var(--color-selio-primary)]" : "border-transparent"}`} type="button">
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">{listing.title}</h1>
            <button type="button" onClick={toggleFavorite} disabled={favBusy} className="selio-btn selio-btn-outline shrink-0" aria-label="Ajouter aux favoris">
              {favorited ?? false ? "♥ Favori" : "♡ Favori"}
            </button>
          </div>
          <p className="mt-2 text-3xl font-bold text-[var(--color-selio-primary)]">{formatPrice(listing.priceCents)}</p>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-[var(--color-selio-text-muted)]">Categorie</dt><dd className="font-medium">{CATEGORY_LABELS[listing.category] ?? listing.category}</dd></div>
            <div><dt className="text-[var(--color-selio-text-muted)]">Etat</dt><dd className="font-medium">{CONDITION_LABELS[listing.condition] ?? listing.condition}</dd></div>
            {listing.size && <div><dt className="text-[var(--color-selio-text-muted)]">Taille</dt><dd className="font-medium">{listing.size}</dd></div>}
            <div><dt className="text-[var(--color-selio-text-muted)]">Favoris</dt><dd className="font-medium">{listing.favoritesCount}</dd></div>
          </dl>

          <p className="mt-5 whitespace-pre-wrap text-[var(--color-selio-text)]">{listing.description}</p>

          <div className="selio-card mt-6 p-4">
            <p className="text-sm font-semibold">Vendu par @{listing.seller.username}</p>
            <p className="text-xs text-[var(--color-selio-text-muted)]">Membre depuis {new Date(listing.seller.memberSince).toLocaleDateString("fr-FR")}</p>
          </div>

          <div className="selio-card mt-4 p-4">
            <p className="selio-label mb-2">Paiement</p>
            <p className="text-sm text-[var(--color-selio-text-muted)]">
              Le paiement securise en ligne n&rsquo;est pas encore disponible sur cette version de demonstration. Convenez du reglement et de la remise en main propre ou de l&rsquo;envoi directement avec le vendeur via la messagerie.
            </p>
            <button type="button" disabled className="selio-btn selio-btn-primary mt-3 w-full opacity-50" title="Bientot disponible (Stripe)">
              Payer en securite — bientot disponible
            </button>
          </div>

          {!isOwner && (
            <form onSubmit={contactSeller} className="selio-card mt-4 space-y-2 p-4">
              <label className="selio-label">Contacter le vendeur</label>
              <textarea className="selio-input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
              <button type="submit" className="selio-btn selio-btn-primary w-full" disabled={sending}>
                {sending ? "Envoi..." : sent ? "Message envoye" : "Envoyer le message"}
              </button>
            </form>
          )}

          {isOwner && <Link to="/account" className="selio-btn selio-btn-outline mt-4 inline-flex">Gerer mes annonces</Link>}
        </div>
      </div>
    </div>
  );
}
