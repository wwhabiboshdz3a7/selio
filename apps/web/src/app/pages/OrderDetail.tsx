import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@selio/contracts";
import { ORDER_TRANSITIONS, orderMargin } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, Field, Input, Money, PageHeader, Tag, formatDateTime, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { ItemThumb, MoneyInput, OrderStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function OrderDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => client.getOrder(id) });
  const [costs, setCosts] = useState({ platformFeeCents: 0, shippingCostCents: 0, otherCostsCents: 0 });
  const [ship, setShip] = useState({ carrier: "", trackingNumber: "" });
  useEffect(() => { if (q.data) { setCosts({ platformFeeCents: q.data.order.platformFeeCents, shippingCostCents: q.data.order.shippingCostCents, otherCostsCents: q.data.order.otherCostsCents }); setShip({ carrier: q.data.shipment?.carrier ?? "", trackingNumber: q.data.shipment?.trackingNumber ?? "" }); } }, [q.data]);
  const inv = ["order", "orders", "items", "item", "overview", "analytics"];
  const transition = useAppMutation((status: OrderStatus) => client.transitionOrder(id, status), { invalidate: inv, success: "Statut mis à jour" });
  const saveCosts = useAppMutation(() => client.updateOrder(id, costs), { invalidate: inv, success: "Frais enregistrés" });
  const saveShip = useAppMutation(() => client.updateShipment(id, { carrier: ship.carrier || null, trackingNumber: ship.trackingNumber || null }), { invalidate: inv, success: "Expédition enregistrée" });
  const doc = useAppMutation(() => client.requestShippingDocument(id), { invalidate: inv, success: "Document demandé au connecteur" });
  const canWrite = session.role !== "viewer";
  return (
    <QueryBoundary query={q} skeleton="spinner">
      {({ order, item, customer, shipment }) => {
        const m = orderMargin(order);
        const next = ORDER_TRANSITIONS[order.status];
        return (
          <>
            <PageHeader eyebrow={<Link to="/app/orders" className="hover:text-text">Commandes</Link>} title={item?.title ?? "Commande"} description={<span className="flex flex-wrap items-center gap-2"><OrderStatusBadge status={order.status} /><Tag>{order.provider}</Tag>{order.simulated ? <Tag>Simulée</Tag> : null}{order.externalRef ? <Tag>{order.externalRef}</Tag> : null}</span>} actions={canWrite && next.length > 0 ? next.map((s) => <Button key={s} variant={s === "cancelled" || s === "refunded" ? "danger" : "secondary"} onClick={() => transition.mutate(s)} loading={transition.isPending}>{ORDER_STATUS_LABELS[s]}</Button>) : undefined} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Marge brute</h2>
                  <DescriptionList columns={2} items={[
                    { label: "Prix de vente", value: <Money cents={order.salePriceCents} />, numeric: true },
                    { label: "Frais plateforme vendeur", value: <Money cents={-order.platformFeeCents} />, numeric: true },
                    { label: "Port à charge vendeur", value: <Money cents={-order.shippingCostCents} />, numeric: true },
                    { label: "Autres coûts", value: <Money cents={-order.otherCostsCents} />, numeric: true },
                    { label: "Coût d'acquisition (figé)", value: <Money cents={-(order.purchasePriceCents + order.purchaseFeesCents)} />, numeric: true },
                    { label: "Marge brute", value: <><Money cents={m.marginCents} signed /> <span className="text-text-muted">({formatPercent(m.marginRate)})</span></>, numeric: true },
                  ]} />
                  <p className="mt-3 text-xs text-text-muted">Marge brute = vente − frais plateforme − port vendeur − autres coûts − coût d'acquisition. Ce n'est pas un bénéfice net comptable.</p>
                  {canWrite && order.status !== "cancelled" && order.status !== "refunded" ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <Field label="Frais plateforme">{(p) => <MoneyInput id={p.id} value={costs.platformFeeCents} onChange={(v) => setCosts({ ...costs, platformFeeCents: v ?? 0 })} allowEmpty={false} />}</Field>
                      <Field label="Port vendeur">{(p) => <MoneyInput id={p.id} value={costs.shippingCostCents} onChange={(v) => setCosts({ ...costs, shippingCostCents: v ?? 0 })} allowEmpty={false} />}</Field>
                      <Field label="Autres coûts">{(p) => <MoneyInput id={p.id} value={costs.otherCostsCents} onChange={(v) => setCosts({ ...costs, otherCostsCents: v ?? 0 })} allowEmpty={false} />}</Field>
                      <div className="sm:col-span-3 flex justify-end"><Button size="sm" onClick={() => saveCosts.mutate()} loading={saveCosts.isPending}>Enregistrer les frais</Button></div>
                    </div>
                  ) : null}
                </Card>
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Expédition</h2>
                  {order.status === "pending" ? <p className="text-sm text-text-muted">L'expédition devient disponible une fois la commande payée.</p> : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Transporteur">{(p) => <Input id={p.id} value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} disabled={!canWrite} />}</Field>
                        <Field label="Numéro de suivi">{(p) => <Input id={p.id} value={ship.trackingNumber} onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })} disabled={!canWrite} />}</Field>
                      </div>
                      {canWrite ? <div className="mt-3 flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" icon={<FileText />} onClick={() => doc.mutate()} loading={doc.isPending}>Demander le document d'expédition</Button><Button size="sm" onClick={() => saveShip.mutate()} loading={saveShip.isPending}>Enregistrer</Button></div> : null}
                      {shipment?.document ? <Alert tone={shipment.document.kind === "demo" ? "warning" : "info"} className="mt-3" title={shipment.document.kind === "demo" ? "Document de démonstration" : "Document fourni par le connecteur"}>{shipment.document.note}{shipment.document.url ? <> · <a href={shipment.document.url} className="underline">Ouvrir</a></> : null}</Alert> : <p className="mt-3 text-xs text-text-muted">Aucun document : Selio ne génère jamais de faux bordereau. Le bordereau réel est fourni par la plateforme de vente.</p>}
                    </>
                  )}
                </Card>
              </div>
              <div className="flex flex-col gap-4">
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Article et client</h2>
                  {item ? <Link to={`/app/items/${item.id}`} className="flex items-center gap-3 text-sm hover:text-accent"><ItemThumb photos={item.photos} title={item.title} size={48} /><span><span className="block font-medium">{item.title}</span><span className="block text-xs text-text-muted">{[item.brand, item.size].filter(Boolean).join(" · ")}</span></span></Link> : <p className="text-sm text-text-muted">Article supprimé.</p>}
                  {customer ? <Link to={`/app/customers/${customer.id}`} className="mt-3 block text-sm hover:text-accent">Client : <span className="font-medium">{customer.displayName}</span></Link> : null}
                  {order.conversationId ? <Link to={`/app/messages/${order.conversationId}`} className="mt-1 block text-sm text-text-muted hover:text-accent">Voir la conversation</Link> : null}
                </Card>
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Historique des statuts</h2>
                  <ol className="flex flex-col gap-2">
                    {[...order.statusHistory].reverse().map((h, i) => <li key={i} className="flex items-center justify-between gap-2 text-sm"><OrderStatusBadge status={h.status} /><span className="text-xs text-text-muted">{formatDateTime(h.at)}</span></li>)}
                  </ol>
                  <p className="mt-3 text-xs text-text-muted">Transitions autorisées depuis « {ORDER_STATUS_LABELS[order.status]} » : {next.length ? next.map((s) => ORDER_STATUS_LABELS[s]).join(", ") : "aucune (état final)"}.</p>
                </Card>
              </div>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}
