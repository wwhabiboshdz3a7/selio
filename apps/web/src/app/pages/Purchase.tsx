import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import type { PurchaseRequest } from "@selio/contracts";
import { Alert, Button, Card, ConfirmDialog, EmptyState, Money, PageHeader, StatusBadge, Tag, formatDateTime } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

const STATUS: Record<PurchaseRequest["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" | "muted" | "accent" }> = {
  draft: { label: "Brouillon", tone: "muted" }, awaiting_confirmation: { label: "À confirmer", tone: "warning" }, simulated: { label: "Simulé", tone: "accent" }, blocked: { label: "Bloqué", tone: "danger" }, executed: { label: "Exécuté", tone: "success" }, cancelled: { label: "Annulé", tone: "muted" },
};

export default function Purchase() {
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["purchases"], queryFn: () => client.listPurchaseRequests() });
  const [confirm, setConfirm] = useState<PurchaseRequest | null>(null);
  const [typed, setTyped] = useState("");
  const confirmMut = useAppMutation((id: string) => client.confirmPurchaseRequest(id), { invalidate: ["purchases", "opportunities"], success: (p) => (p.status === "simulated" ? "Achat simulé de bout en bout (aucun paiement réel)" : p.status === "blocked" ? "Achat bloqué par les contrôles" : "Demande traitée"), onSuccess: () => setConfirm(null) });
  const cancel = useAppMutation((id: string) => client.cancelPurchaseRequest(id), { invalidate: ["purchases"], success: "Demande annulée" });
  const canConfirm = session.role !== "viewer";
  return (
    <>
      <PageHeader title="Achat assisté" description="Préparez un achat avec budget, prix maximal et contrôles. L'exécution réelle est désactivée : tout est simulé de bout en bout." />
      <Alert tone="warning" className="mb-4" title="Achat réel désactivé">Aucun endpoint d'achat n'existe. Pour qu'un achat réel soit possible, il faudrait un connecteur autorisé techniquement et contractuellement, une confirmation explicite et la prévention des doublons. Tant que ce n'est pas le cas, l'exécution est une simulation marquée comme telle.</Alert>
      <QueryBoundary query={q} empty={(d) => d.length === 0 ? <EmptyState title="Aucune demande d'achat" description="Depuis le Radar, cliquez sur « Préparer l'achat » sur une opportunité." action={<Link to="/app/radar"><Button variant="secondary">Ouvrir le Radar</Button></Link>} /> : null}>
        {(list) => (
          <div className="flex flex-col gap-3">
            {list.map((p) => (
              <Card key={p.id} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-md font-semibold">{p.opportunity?.title ?? "Opportunité supprimée"}</h2>
                    <StatusBadge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</StatusBadge>
                    {p.realPurchaseEnabled ? <Tag accent>Achat réel</Tag> : <Tag>Simulation</Tag>}
                  </div>
                  <p className="mt-1 text-sm text-text-muted">Prix max <Money cents={p.maxPriceCents} /> · budget <Money cents={p.budgetCents} /> · créée {formatDateTime(p.createdAt)}</p>
                  {p.opportunity ? <p className="text-sm text-text-muted">Observé <Money cents={p.opportunity.observed.priceCents + p.opportunity.observed.shippingCents} /> port compris · marge estimée <Money cents={p.opportunity.estimate.marginCents} signed /></p> : null}
                  {p.checks.length > 0 ? (
                    <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                      {p.checks.map((c) => <li key={c.code} className="flex items-start gap-1.5">{c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}<span className={c.ok ? "text-text" : "text-danger"}>{c.label}</span></li>)}
                    </ul>
                  ) : <p className="mt-2 text-xs text-text-muted">Les contrôles s'exécutent à la confirmation : prix max, budget de la demande, budget journalier, doublon, marge positive, confirmation explicite, connecteur autorisé.</p>}
                  {p.resultNote ? <p className="mt-2 text-xs text-text-muted">{p.resultNote}</p> : null}
                </div>
                {canConfirm ? (
                  <div className="flex flex-row flex-wrap gap-2 md:flex-col">
                    {p.status === "awaiting_confirmation" ? <><Button size="sm" onClick={() => setConfirm(p)}>Confirmer (simulation)</Button><Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)}>Annuler</Button></> : null}
                    {p.opportunity ? <Link to="/app/radar"><Button size="sm" variant="ghost">Voir dans le Radar</Button></Link> : null}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm && confirmMut.mutate(confirm.id)} loading={confirmMut.isPending} title="Confirmer la demande d'achat ?" description="Les contrôles s'exécutent maintenant. Comme l'achat réel est désactivé, le résultat sera une simulation : aucun paiement, aucune commande chez un vendeur." confirmLabel="Je confirme (simulation)" typeToConfirm="SIMULER" typed={typed} onTypedChange={setTyped} />
    </>
  );
}
