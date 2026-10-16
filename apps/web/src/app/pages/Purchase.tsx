import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, Images, User, X } from "lucide-react";
import type { PurchaseRequest } from "@selio/contracts";
import { REVIEW_THRESHOLD, dealEconomics } from "@selio/domain";
import { Alert, Button, Card, ConfirmDialog, EmptyState, PageHeader, StatusBadge, Tag, formatCents, formatDateTime } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { OpportunityCard } from "../components/deals";
import { ScoreRing } from "../../components/charts";

const STATUS: Record<PurchaseRequest["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" | "muted" | "accent" }> = {
  draft: { label: "Brouillon", tone: "muted" }, awaiting_confirmation: { label: "À confirmer", tone: "warning" }, simulated: { label: "Acheté (simulé)", tone: "success" }, blocked: { label: "Bloqué", tone: "danger" }, executed: { label: "Acheté", tone: "success" }, cancelled: { label: "Annulé", tone: "muted" },
};

export default function Purchase() {
  const client = useClient();
  const session = useRequiredSession();
  const toReview = useQuery({ queryKey: ["opportunities", "to-review"], queryFn: async () => (await client.listOpportunities({ status: "new" })).filter((o) => o.score >= REVIEW_THRESHOLD) });
  const purchases = useQuery({ queryKey: ["purchases"], queryFn: () => client.listPurchaseRequests() });
  const [confirm, setConfirm] = useState<PurchaseRequest | null>(null);
  const buy = useAppMutation((id: string) => client.quickBuy(id), { invalidate: ["purchases", "opportunities", "nav-counts"], success: (p) => (p.status === "blocked" ? "Achat bloqué par les contrôles : voir le détail dans l'historique" : "Achat validé (simulé) en un clic") });
  const dismiss = useAppMutation((id: string) => client.setOpportunityStatus(id, "dismissed"), { invalidate: ["opportunities", "nav-counts"], success: "Affaire écartée" });
  const watch = useAppMutation((id: string) => client.setOpportunityStatus(id, "watching"), { invalidate: ["opportunities", "nav-counts"], success: "Affaire suivie" });
  const confirmMut = useAppMutation((id: string) => client.confirmPurchaseRequest(id), { invalidate: ["purchases", "opportunities", "nav-counts"], success: (p) => (p.status === "simulated" ? "Achat simulé de bout en bout (aucun paiement réel)" : p.status === "blocked" ? "Achat bloqué par les contrôles" : "Demande traitée"), onSuccess: () => setConfirm(null) });
  const cancel = useAppMutation((id: string) => client.cancelPurchaseRequest(id), { invalidate: ["purchases", "opportunities"], success: "Demande annulée" });
  const canBuy = session.role !== "viewer";
  const fees = session.org.settings.buyerFees;

  return (
    <>
      <PageHeader
        eyebrow="Achat assisté"
        title="À valider"
        description={`La liste des bonnes affaires repérées par le radar (note de ${REVIEW_THRESHOLD}/100 ou plus). Vérifiez le calcul achat → revente → bénéfice, puis validez l'achat en un clic, suivez ou écartez. L'historique des achats est en bas de page.`}
        actions={<><Link to="/app/radar"><Button variant="secondary">Bonnes affaires</Button></Link><Link to="/app/auto-buy"><Button variant="secondary" icon={<Bot />}>Achat auto</Button></Link></>}
      />
      <Alert tone="warning" className="mb-5" title="Achat réel désactivé">Valider déclenche un achat SIMULÉ, avec tous les contrôles (prix maximal, budget, plafond du jour, doublon, marge positive). Aucun paiement ni commande chez un vendeur tant qu'un connecteur d'achat autorisé n'existe pas.</Alert>

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-md font-semibold">Affaires à valider <span className="num text-text-muted">({toReview.data?.length ?? 0})</span></h2>
        </div>
        <QueryBoundary query={toReview} empty={(d) => d.length === 0 ? <EmptyState icon={<Check />} title="Rien à valider" description="Toutes les bonnes affaires ont été traitées. Lancez une analyse dans « Bonnes affaires » pour en trouver d'autres." action={<Link to="/app/radar"><Button variant="secondary">Bonnes affaires</Button></Link>} /> : null}>
          {(list) => (
            <div className="grid gap-3 2xl:grid-cols-2">
              {list.map((o) => <OpportunityCard key={o.id} o={o} canWrite={canBuy} compact onBuy={() => buy.mutate(o.id)} buying={buy.isPending && buy.variables === o.id} onStatus={(s) => (s === "dismissed" ? dismiss.mutate(o.id) : s === "watching" ? watch.mutate(o.id) : undefined)} />)}
            </div>
          )}
        </QueryBoundary>
      </section>

      <section>
        <h2 className="mb-3 text-md font-semibold">Historique des achats</h2>
        <QueryBoundary query={purchases} empty={(d) => d.length === 0 ? <EmptyState title="Aucun achat pour l'instant" description="Les achats validés à la main et les achats automatiques apparaissent ici." /> : null}>
          {(list) => (
            <Card padding="none" className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead><tr className="border-b border-border text-left">{["Article", "Mode", "Note", "Total payé", "Revente estimée", "Bénéfice", "Statut", ""].map((h) => <th key={h} className="th-label px-4 py-2.5 first:pl-5">{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((p) => {
                    const o = p.opportunity;
                    const d = o ? dealEconomics(o.observed, o.estimate.resalePriceCents, fees, o.estimate.expectedFeesCents) : null;
                    return (
                      <tr key={p.id} className="border-b border-border align-middle last:border-0">
                        <td className="px-4 py-3 pl-5">
                          <span className="flex items-center gap-3">
                            {o?.observed.photoUrl ? <img src={o.observed.photoUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-muted text-text-subtle"><Images className="size-4" aria-hidden /></span>}
                            <span className="min-w-0"><span className="block truncate font-medium text-text">{o?.title ?? "Affaire supprimée"}</span><span className="num block text-xs text-text-muted">{formatDateTime(p.createdAt)}</span></span>
                          </span>
                        </td>
                        <td className="px-4 py-3">{p.mode === "auto" ? <Tag accent><Bot className="mr-1 size-3" aria-hidden />Auto</Tag> : <Tag><User className="mr-1 size-3" aria-hidden />Manuel</Tag>}</td>
                        <td className="px-4 py-3">{o ? <ScoreRing score={o.score} size={36} stroke={4} /> : "—"}</td>
                        <td className="num px-4 py-3 font-medium">{d ? formatCents(d.totalCents) : formatCents(p.maxPriceCents)}{d ? <span className="block text-[11px] text-text-muted">{formatCents(d.itemCents)} + {formatCents(d.shippingCents)} + {formatCents(d.protectionCents)}</span> : null}</td>
                        <td className="num px-4 py-3">{d ? formatCents(d.resaleCents) : "—"}</td>
                        <td className="num px-4 py-3">{d ? <span className={d.profitCents > 0 ? "font-semibold text-success" : "font-semibold text-danger"}>{d.profitCents > 0 ? "+" : ""}{formatCents(d.profitCents)}<span className="block text-[11px] font-normal whitespace-nowrap text-text-muted">marge {Math.round(d.marginRate * 100)} %</span></span> : "—"}</td>
                        <td className="px-4 py-3"><StatusBadge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</StatusBadge>{p.checks.some((c) => !c.ok) ? <span className="mt-1 block text-[11px] text-danger">{p.checks.filter((c) => !c.ok && c.code !== "connector_authorized").map((c) => c.label).join(" · ")}</span> : null}</td>
                        <td className="px-4 py-3 text-right">
                          {canBuy && p.status === "awaiting_confirmation" ? <span className="inline-flex gap-1"><Button size="sm" onClick={() => setConfirm(p)}>Confirmer</Button><Button size="sm" variant="ghost" icon={<X />} onClick={() => cancel.mutate(p.id)}>Annuler</Button></span> : null}
                          {p.mode === "auto" && p.cancelableUntil && new Date(p.cancelableUntil) > new Date() && p.status === "simulated" ? <Link to="/app/auto-buy" className="text-xs font-medium text-accent underline-offset-2 hover:underline">Annulable</Link> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </QueryBoundary>
      </section>
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm && confirmMut.mutate(confirm.id)} loading={confirmMut.isPending} title="Confirmer la demande d'achat ?" description="Les contrôles s'exécutent maintenant. L'achat réel étant désactivé, le résultat sera une simulation : aucun paiement, aucune commande chez un vendeur." confirmLabel="Je confirme (simulation)" />
    </>
  );
}
