import { Link } from "@tanstack/react-router";
import { Tilt3D } from "../ui/Tilt3D";
import { formatPrice, CONDITION_LABELS } from "../../lib/format";

export type ListingSummary = {
  id: string;
  title: string;
  priceCents: number;
  category: string;
  condition: string;
  coverImageUrl: string | null;
  seller: { username: string; displayName: string };
};

export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <Tilt3D className="selio-card-premium overflow-hidden">
      <Link to="/listing/$id" params={{ id: listing.id }} className="group block">
        <div className="aspect-square w-full overflow-hidden bg-[var(--color-selio-surface)]">
          {listing.coverImageUrl ? (
            <img src={listing.coverImageUrl} alt={listing.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-[var(--color-selio-text-muted)]">Pas de photo</div>
          )}
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-semibold text-[var(--color-selio-primary-dark)]">{listing.title}</p>
          <p className="mt-0.5 text-base font-bold text-[var(--color-selio-primary)]">{formatPrice(listing.priceCents)}</p>
          <p className="mt-1 truncate text-xs text-[var(--color-selio-text-muted)]">
            {CONDITION_LABELS[listing.condition] ?? listing.condition} · @{listing.seller.username}
          </p>
        </div>
      </Link>
    </Tilt3D>
  );
}
