import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Layers, MessageSquarePlus } from "lucide-react";
import { BUNDLE_REASON_LABELS } from "@selio/domain";
import { Button, Card, EmptyState, Money, PageHeader, StatusBadge, Textarea, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import type { BundleSuggestionView } from "../../lib/data/types";
import { bundleProposalText } from "../../lib/selling/negotiation";
import { ItemThumb, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

/**
 * Lots intelligents (§5.14) : Selio repère les lots à proposer (un acheteur intéressé par plusieurs
 * articles, une même marque et taille, des articles en ligne depuis longtemps), calcule le prix du lot
 * avec vos remises de lot, jamais sous la somme des planchers, et la marge projetée. « Créer le lot »
 * prépare un brouillon d'offre à valider : rien ne part tout seul.
 */
export default function Bundles() {
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["bundles"], queryFn: () => client.suggestBundles() });
  const canWrite = session.role !== "viewer";
  const lot = session.org.settings.automation.negotiation.lot;
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/app/items" className="hover:text-text">Articles et stock</Link>}
        title="Lots intelligents"
        description="Les lots à proposer, repérés dans votre stock et vos conversations : prix du lot calculé avec vos remises, jamais sous la somme des planchers, et marge projetée."
        actions={<Link to="/app/automatisation/negociation" className="text-sm font-medium text-accent hover:underline">Régler les remises de lot</Link>}
      />
      <p className="mb-4 text-sm text-text-muted">Remises de lot : {lot.enabled ? <>{formatPercent(lot.twoItemsRate)} pour 2 articles, {formatPercent(lot.threePlusRate)} pour 3 et plus.</> : "désactivées (prix des lots sans remise)."}</p>
      <QueryBoundary query={q} empty={(d) => (d.length === 0 ? <EmptyState icon={<Layers />} title="Aucun lot à proposer pour l'instant" description="Selio propose un lot quand un acheteur s'intéresse à plusieurs articles, quand plusieurs articles partagent marque et taille, ou quand des articles sont en ligne depuis longtemps." /> : null)}>
        {(list) => (
          <ul className="grid gap-4 lg:grid-cols-2" aria-label="Propositions de lots">
            {list.map((b) => <li key={b.id} className="min-w-0"><BundleCard b={b} canWrite={canWrite} /></li>)}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}

function BundleCard({ b, canWrite }: { b: BundleSuggestionView; canWrite: boolean }) {
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const [copyText, setCopyText] = useState<string | null>(null);
  const firstName = b.customer?.displayName.split(" ")[0] ?? "";
  const text = bundleProposalText({ prenom: firstName, titles: b.items.map((i) => i.title), priceCents: b.bundlePriceCents, listedTotalCents: b.listedTotalCents, messages: session.org.settings.automation.negotiation.messages });
  const create = useAppMutation(async () => {
    if (!b.conversationId) {
      setCopyText(text);
      return null;
    }
    return client.createDraft({ conversationId: b.conversationId, body: text, offerCents: b.bundlePriceCents });
  }, { invalidate: ["conversation", "conversations"], success: (m) => (m ? "Brouillon d'offre de lot prêt dans la messagerie" : null), onSuccess: (m) => { if (m) navigate(`/app/messages/${m.conversationId}`); } });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? text);
    } catch {
      /* presse-papiers refusé : le texte reste sélectionnable */
    }
  };
  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-md font-semibold text-text">{b.items.length} articles · <Money cents={b.bundlePriceCents} /></h2>
          <p className="text-sm text-text-muted">{b.label}</p>
        </div>
        <StatusBadge tone={b.reason === "same_buyer" ? "accent" : "neutral"}>{BUNDLE_REASON_LABELS[b.reason].split(" ").slice(0, 3).join(" ")}</StatusBadge>
      </div>
      {b.customer ? <p className="text-sm text-text">Acheteur : <Link to={`/app/customers/${b.customer.id}`} className="font-medium hover:text-accent">{b.customer.displayName}</Link></p> : null}
      <ul className="flex flex-col gap-2">
        {b.items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 text-sm">
            <ItemThumb photos={it.photos} title={it.title} size={40} />
            <Link to={`/app/items/${it.id}`} className="min-w-0 flex-1 truncate hover:text-accent">{it.title}</Link>
            <span className="num shrink-0 text-text-muted">{it.listedPriceCents !== null ? <Money cents={it.listedPriceCents} /> : "—"}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-text-muted">Total affiché</dt><dd className="num font-medium"><Money cents={b.listedTotalCents} /></dd></div>
        <div><dt className="text-xs text-text-muted">Prix du lot</dt><dd className="num font-medium"><Money cents={b.bundlePriceCents} /> <span className="text-xs text-text-muted">(−{formatPercent(b.suggestedDiscountRate)})</span></dd></div>
        <div><dt className="text-xs text-text-muted">Plancher du lot</dt><dd className="num font-medium"><Money cents={b.floorCents} /></dd></div>
        <div><dt className="text-xs text-text-muted">Marge projetée</dt><dd className="num font-medium"><Money cents={b.projectedMarginCents} signed /> <span className="text-xs text-text-muted">({formatPercent(b.projectedMarginRate)})</span></dd></div>
      </dl>
      {b.discountCapped ? <p className="text-xs text-text-muted">Remise réduite pour rester au-dessus du plancher du lot (somme des planchers des articles).</p> : null}
      {copyText ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-text-muted" htmlFor={`lot-${b.id}`}>Aucune conversation avec un acheteur : copiez cette proposition (annonce de lot ou message).</label>
          <Textarea id={`lot-${b.id}`} rows={3} readOnly value={copyText} />
          <div><Button size="sm" variant="secondary" icon={<Copy />} onClick={() => void copy()}>Copier</Button></div>
        </div>
      ) : null}
      {canWrite ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button variant="secondary" icon={<MessageSquarePlus />} onClick={() => create.mutate(undefined)} loading={create.isPending}>Créer le lot</Button>
          <span className="text-xs text-text-muted">{b.conversationId ? "Brouillon d'offre à valider dans la messagerie." : "Texte prêt à copier."}</span>
        </div>
      ) : null}
    </Card>
  );
}
