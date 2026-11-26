import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Tag as TagIcon, X } from "lucide-react";
import { Field, IconButton, Input, cn, formatCents } from "@selio/ui";
import { useData } from "../../lib/data/provider";
import { dismissOffer, loadOfferBanner, readDismissedOffers } from "../../lib/offers";

/**
 * Offres commerciales à l'écran : bandeau en haut (vitrine et espace client, refermable, fermeture mémorisée
 * par offre), prix remisé à côté du prix normal, champ « Code promo » de l'inscription.
 */

/** Offres publiques (bandeau) : mises en cache une minute, comme la réponse du serveur. */
export function useOfferBanner(scope: "app" | "vitrine") {
  const { client, mode } = useData();
  return useQuery({ queryKey: ["offer-banner", mode, scope], queryFn: () => loadOfferBanner(client, mode, scope), staleTime: 60_000, retry: false });
}

/** Bandeau en haut de page : la plus récente offre non refermée. Rien quand il n'y en a pas. */
export function OfferBanner({ scope }: { scope: "app" | "vitrine" }) {
  const offers = useOfferBanner(scope);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissedOffers());
  const offer = offers.data?.find((o) => !dismissed.includes(o.id));
  if (!offer) return null;
  return (
    <div role="region" aria-label="Offre en cours" data-testid="offer-banner" className="flex min-h-9 items-center justify-center gap-2 border-b border-border bg-surface-muted px-10 py-1.5 text-center text-xs text-text relative">
      <TagIcon className="size-3.5 shrink-0 text-accent" aria-hidden />
      <span><span className="font-medium">{offer.bannerText}</span>{offer.endsAt ? <span className="text-text-muted"> · jusqu'au {new Date(offer.endsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span> : null}</span>
      <Link to={scope === "app" ? "/app/settings/billing" : offer.code ? `/inscription?code=${encodeURIComponent(offer.code)}` : "/tarifs"} className="font-medium text-accent underline-offset-2 hover:underline">
        {scope === "app" ? "En profiter" : "J'en profite"}
      </Link>
      <IconButton label="Fermer le bandeau de l'offre" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2" onClick={() => setDismissed(dismissOffer(offer.id))}><X /></IconButton>
    </div>
  );
}

/** Prix normal barré et prix remisé (accessibles : la lecture d'écran dit les deux). */
export function DiscountedPrice({ normalCents, discountedCents, className }: { normalCents: number; discountedCents: number; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5", className)} data-testid="discounted-price">
      <s className="text-text-muted font-normal" aria-label={`Prix normal ${formatCents(normalCents)}`}>{formatCents(normalCents)}</s>
      <span aria-label={`Prix remisé ${formatCents(discountedCents)}`}>{formatCents(discountedCents)}</span>
    </span>
  );
}

/** Ligne « avec le code PRINTEMPS » sous un prix remisé. */
export function OfferHint({ text, title }: { text: string; title?: string }) {
  return <span className="block text-xs font-normal text-accent" title={title}>{text}</span>;
}

/** Champ « Code promo » du formulaire d'inscription (facultatif, jamais bloquant). */
export function PromoCodeField({ value, onChange, onBlur, error, hint }: { value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; hint?: string }) {
  return (
    <Field label="Code promo" error={error} hint={hint ?? "Facultatif. Code bêta ou code promo : vérifié avant la création du compte."}>
      {(p) => (
        <Input
          id={p.id}
          invalid={p.invalid}
          aria-describedby={p.describedBy}
          value={value}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          placeholder="ex. PRINTEMPS"
          className="num tracking-[0.1em]"
          name="promoCode"
        />
      )}
    </Field>
  );
}
