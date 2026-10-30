import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, EyeOff, ExternalLink, Images, ShoppingBag, Star } from "lucide-react";
import { ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, PURCHASE_STATUS_LABELS } from "@selio/contracts";
import { can, dealEconomics, scoreBand } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, Dialog, Field, PageHeader, StatusBadge, Tag, buttonClass, cn, formatCents, formatDateTime, formatRelative } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import type { OpportunityDetail } from "../../lib/data/types";
import { detectionDelaySeconds, estimateMethodLabel, formatDuration } from "../../lib/radar";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { BandBadge, DealMath, ScoreBreakdown } from "../components/deals";
import { RADAR_KEYS, SourceTag } from "../components/radar";
import { ScoreRing } from "../../components/charts";

/**
 * Page d'une affaire (« 1 clic »), ouverte depuis une alerte sur le téléphone ou le flux de Radar :
 * le client ouvre l'annonce sur Vinted et achète LUI-MÊME. Selio n'achète rien ici (D11) : « Je l'ai
 * achetée » enregistre l'achat et reporte le prix d'achat dans Manager pour suivre la marge.
 */
export default function RadarDeal() {
  const { id = "" } = useParams();
  const client = useClient();
  const query = useQuery({ queryKey: ["opportunity", id], queryFn: () => client.getOpportunity(id), enabled: id !== "" });
  return (
    <>
      <Link to="/app/radar" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden />Bonnes affaires</Link>
      <QueryBoundary query={query} skeleton="spinner">{(o) => <Deal o={o} />}</QueryBoundary>
    </>
  );
}

function Deal({ o }: { o: OpportunityDetail }) {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const fees = session.org.settings.buyerFees;
  const d = dealEconomics(o.observed, o.estimate.resalePriceCents, fees, o.estimate.expectedFeesCents);
  const canBuy = can(session.role, "purchase.simulate");
  const canSort = can(session.role, "radar.write");
  const [confirm, setConfirm] = useState(false);
  // Prix réellement payé (port compris), modifiable : prérempli avec le coût estimé de l'affaire.
  const [paidCents, setPaidCents] = useState<number | null>(d.totalCents);
  const bought = useAppMutation(() => client.quickBuy(o.id, { paidCents }), {
    invalidate: [...RADAR_KEYS, "items"],
    success: (p) => (p.status === "blocked" ? null : "Achat enregistré : prix d'achat reporté dans Manager"),
    onSuccess: () => setConfirm(false),
  });
  const ignore = useAppMutation(() => client.setOpportunityStatus(o.id, "dismissed"), { invalidate: RADAR_KEYS, success: "Affaire ignorée" });
  const restore = useAppMutation(() => client.setOpportunityStatus(o.id, "new"), { invalidate: RADAR_KEYS, success: "Affaire restaurée" });
  const purchase = bought.data ?? o.purchase;
  const blocked = bought.data?.status === "blocked";
  const delay = detectionDelaySeconds(o);
  const method = estimateMethodLabel(o.estimate.method);
  const band = scoreBand(o.score);
  const done = o.status === "purchased" || (purchase !== null && purchase.status !== "blocked" && purchase.status !== "cancelled");

  return (
    <>
      <PageHeader
        eyebrow="Radar · affaire"
        title={o.title}
        description={[o.observed.brand, o.observed.size ? `taille ${o.observed.size}` : null, o.observed.condition ? ITEM_CONDITION_LABELS[o.observed.condition] : null, o.observed.category ? ITEM_CATEGORY_LABELS[o.observed.category] : null].filter(Boolean).join(" · ")}
      />

      <Alert tone="info" className="mb-5" title="Vous achetez vous-même sur Vinted">
        L'achat réel par Selio est désactivé (D11) : ouvrez l'annonce, achetez avec votre compte, puis touchez « Je l'ai achetée » pour reporter le prix d'achat dans Manager. Selio ne paie et ne commande rien à votre place.
      </Alert>

      {done && purchase ? (
        <Alert tone="success" className="mb-5" title={`Achat enregistré · ${PURCHASE_STATUS_LABELS[purchase.status]}`}>
          {purchase.totalCents != null ? <>Prix d'achat reporté : <span className="num font-medium text-text">{formatCents(purchase.totalCents)}</span>. </> : null}
          {purchase.reportedItemId ? <Link to={`/app/items/${purchase.reportedItemId}`} className="font-medium text-accent underline-offset-2 hover:underline">Voir l'article dans le stock</Link> : null}
        </Alert>
      ) : null}
      {blocked && bought.data ? (
        <Alert tone="danger" className="mb-5" title="Achat non enregistré">
          {bought.data.resultNote}
        </Alert>
      ) : null}
      {done && purchase && purchase.checks.some((c) => !c.ok && c.code !== "connector_authorized") ? (
        <Alert tone="warning" className="mb-5" title="À vérifier (l'achat est bien enregistré)">
          {purchase.checks.filter((c) => !c.ok && c.code !== "connector_authorized").map((c) => c.label).join(" · ")}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative">
            {o.observed.photoUrl ? (
              <img src={o.observed.photoUrl} alt={o.title} className="aspect-[4/5] w-full rounded-xl bg-surface-muted object-cover" />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center rounded-xl bg-surface-muted text-text-subtle"><Images className="size-8" aria-hidden /><span className="sr-only">Photo effacée ou absente</span></div>
            )}
            <span className="absolute top-3 left-3 rounded-full bg-surface p-0.5 shadow-sm"><ScoreRing score={o.score} size={60} stroke={6} /></span>
          </div>
          <Card>
            <div className="flex flex-col gap-2">
              {o.itemUrl ? (
                <a href={o.itemUrl} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "accent", size: "lg", fullWidth: true })}>
                  <ExternalLink aria-hidden />Ouvrir l'annonce sur Vinted
                </a>
              ) : (
                <>
                  <Button variant="accent" size="lg" fullWidth icon={<ExternalLink />} disabled>Ouvrir l'annonce sur Vinted</Button>
                  <p className="text-xs text-text-muted">{mode === "demo" ? "Démonstration : annonce fictive, aucun lien vers Vinted." : "Adresse de l'annonce absente ou non vérifiée (seuls les domaines Vinted sont ouverts)."}</p>
                </>
              )}
              <p className="text-xs text-text-muted">Nouvel onglet : vous vérifiez l'annonce et payez vous-même sur Vinted.</p>
              {canBuy && !done ? (
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <Button variant="secondary" icon={<ShoppingBag />} onClick={() => setConfirm(true)}>Je l'ai achetée</Button>
                  {o.status === "dismissed"
                    ? <Button variant="ghost" onClick={() => restore.mutate(undefined)} loading={restore.isPending} disabled={!canSort}>Restaurer</Button>
                    : <Button variant="ghost" icon={<EyeOff />} onClick={() => ignore.mutate(undefined)} loading={ignore.isPending} disabled={!canSort}>Ignorer</Button>}
                </div>
              ) : null}
              {o.status === "dismissed" ? <p className="text-xs text-text-muted">Affaire ignorée : elle n'apparaît plus dans les bonnes affaires.</p> : null}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-md font-semibold">Prix, frais et total</h2>
              {done ? <Tag accent><CheckCircle2 className="mr-1 size-3" aria-hidden />Achetée</Tag> : null}
            </div>
            <DealMath opportunity={o} fees={fees} />
            <p className="num mt-3 text-sm text-text-muted">Total à payer sur Vinted : <span className="font-semibold text-text">{formatCents(d.totalCents)}</span> (prix {formatCents(d.itemCents)} + port {formatCents(d.shippingCents)} + protection acheteurs {formatCents(d.protectionCents)}).</p>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-md font-semibold">Pourquoi {Math.round(o.score)}/100</h2>
              <BandBadge score={o.score} />
            </div>
            <p className="mb-3 text-sm text-text-muted">{band.advice}.</p>
            <ScoreBreakdown breakdown={o.breakdown} reasons={o.reasons} />
          </Card>

          <Card>
            <h2 className="mb-3 text-md font-semibold">Revente estimée</h2>
            <DescriptionList columns={2} items={[
              { label: "Prix de revente estimé", value: formatCents(o.estimate.resalePriceCents), numeric: true },
              { label: "Méthode", value: <span title={method.detail}>{method.label}</span> },
              { label: "Ventes comparables", value: String(o.estimate.comparableCount), numeric: true },
              { label: "Confiance", value: o.estimate.confidence === "high" ? "Élevée" : o.estimate.confidence === "medium" ? "Moyenne" : "Faible" },
            ]} />
            <p className="mt-3 text-xs text-text-muted">{method.detail} Une estimation, jamais une donnée observée.</p>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-md font-semibold">Vendeur</h2>
              {o.observed.sellerRating !== null || o.observed.sellerReviews !== null ? (
                <p className="num flex items-center gap-1.5 text-sm text-text">
                  {o.observed.sellerRating !== null ? <><Star className="size-4 fill-current text-gold" aria-hidden />{o.observed.sellerRating.toFixed(1).replace(".", ",")} / 5</> : null}
                  <span className="text-text-muted">· {o.observed.sellerReviews ?? 0} avis</span>
                </p>
              ) : <p className="text-sm text-text-muted">Note du vendeur non affichée.</p>}
              {o.observed.sellerHandle ? <p className="mt-1 text-sm text-text-muted">@{o.observed.sellerHandle}</p> : null}
              <p className="mt-2 text-xs text-text-muted">Pseudo, note et photo gardés le temps de l'affaire seulement, puis effacés (30 jours au plus).</p>
            </Card>
            <Card>
              <h2 className="mb-2 text-md font-semibold">Détection</h2>
              <p className="num text-sm text-text">{delay !== null ? <>Repérée <span className="font-semibold">{formatDuration(delay)}</span> après la publication</> : <span className="text-text-muted">Délai à mesurer : la page ne montrait pas la date de publication.</span>}</p>
              <p className="num mt-1 text-xs text-text-muted">{o.observed.detectedAt ? `Détectée ${formatRelative(o.observed.detectedAt)} (${formatDateTime(o.observed.detectedAt)})` : `Vue ${formatRelative(o.observed.seenAt)}`}</p>
              {o.search ? <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">Recherche « {o.search.name} » <SourceTag search={o.search} /></p> : null}
            </Card>
          </div>
          {purchase && !done ? <p className={cn("text-xs text-text-muted")}>Dernière demande : <StatusBadge tone="muted">{PURCHASE_STATUS_LABELS[purchase.status]}</StatusBadge></p> : null}
        </div>
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Vous avez acheté cet article sur Vinted ?"
        description="Selio enregistre l'achat et crée l'article « en stock » dans Manager avec ce prix d'achat, pour suivre la marge à la revente. Aucun paiement n'est fait par Selio."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={bought.isPending}>Annuler</Button>
            <Button onClick={() => bought.mutate(undefined)} loading={bought.isPending}>Oui, je l'ai achetée</Button>
          </>
        }
      >
        <Field label="Prix payé, port et protection compris" hint={`Estimé : ${formatCents(d.totalCents)}${o.observed.shippingShown === false ? " (port non affiché sur la recherche : corrigez-le si besoin)" : ""}. Corrigez-le si vous avez payé un autre montant.`}>
          {(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={paidCents} onChange={setPaidCents} allowEmpty />}
        </Field>
      </Dialog>
    </>
  );
}
