import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderQuery } from "@selio/contracts";
import { orderMargin } from "@selio/domain";
import { Button, Dialog, EmptyState, Field, Input, Money, PageHeader, Pagination, Select, Table, TableEmpty, TableWrap, Td, Th, Tr, Tag, formatDate, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { ItemThumb, MoneyInput, OrderStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Orders() {
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query: Partial<OrderQuery> = { q: params.get("q") ?? undefined, status: (params.get("status") as OrderQuery["status"]) || undefined, page: Number(params.get("page") ?? 1), pageSize: 25 };
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== "page") p.delete("page"); setParams(p, { replace: true }); };
  const q = useQuery({ queryKey: ["orders", query], queryFn: () => client.listOrders(query) });
  const [open, setOpen] = useState(false);
  const items = useQuery({ queryKey: ["items", { forOrder: true }], queryFn: () => client.listItems({ pageSize: 200, sort: "title_asc" }), enabled: open });
  const customers = useQuery({ queryKey: ["customers", { forOrder: true }], queryFn: () => client.listCustomers({ pageSize: 200, sort: "name_asc" }), enabled: open });
  const [form, setForm] = useState({ itemId: "", customerId: "", salePriceCents: null as number | null, shippingCostCents: 0 as number | null, externalRef: "" });
  const create = useAppMutation(() => client.createOrder({ itemId: form.itemId, customerId: form.customerId, salePriceCents: form.salePriceCents ?? 0, shippingCostCents: form.shippingCostCents ?? 0, externalRef: form.externalRef || null }), { invalidate: ["orders", "items", "overview"], success: (r) => (r.created ? "Commande créée" : "Commande existante réutilisée (aucun doublon)"), onSuccess: (r) => { setOpen(false); navigate(`/app/orders/${r.order.id}`); } });
  const selectedItem = items.data?.items.find((i) => i.id === form.itemId);
  return (
    <>
      <PageHeader title="Commandes" description="Une commande fige le coût d'acquisition et calcule la marge brute. Les transitions de statut sont contrôlées." actions={session.role !== "viewer" ? <Button icon={<Plus />} onClick={() => setOpen(true)}>Nouvelle commande</Button> : undefined} />
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Input placeholder="Rechercher article, client, référence…" prefix={<Search />} value={query.q ?? ""} onChange={(e) => set("q", e.target.value)} aria-label="Recherche" />
        <Select value={query.status ?? ""} onChange={(e) => set("status", e.target.value)} aria-label="Statut"><option value="">Tous les statuts</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}</Select>
      </div>
      <QueryBoundary query={q} empty={(d) => d.total === 0 && !query.q && !query.status ? <EmptyState title="Aucune commande" description="Créez une commande depuis une conversation (offre acceptée) ou manuellement." /> : null}>
        {(d) => (
          <>
            <TableWrap>
              <Table>
                <thead><tr><Th>Article</Th><Th>Client</Th><Th>Statut</Th><Th className="hide-mobile">Date</Th><Th numeric>Vente</Th><Th numeric>Marge brute</Th></tr></thead>
                <tbody>
                  {d.items.length === 0 ? <TableEmpty colSpan={6}>Aucune commande ne correspond.</TableEmpty> : d.items.map((o) => {
                    const m = orderMargin(o);
                    return (
                      <Tr key={o.id} interactive tabIndex={0} onClick={() => navigate(`/app/orders/${o.id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/app/orders/${o.id}`); }}>
                        <Td><span className="flex items-center gap-3">{o.item ? <ItemThumb photos={o.item.photos} title={o.item.title} /> : null}<span className="min-w-0"><span className="block truncate font-medium">{o.item?.title ?? "Article supprimé"}</span><span className="block text-xs text-text-muted">{o.externalRef ?? o.id.slice(0, 8)} · {o.provider}{o.simulated ? " · simulé" : ""}</span></span></span></Td>
                        <Td>{o.customer?.displayName ?? "—"}</Td>
                        <Td><OrderStatusBadge status={o.status} /></Td>
                        <Td className="hide-mobile text-text-muted">{formatDate(o.createdAt)}</Td>
                        <Td numeric><Money cents={o.salePriceCents} /></Td>
                        <Td numeric><span className="inline-flex flex-col items-end"><Money cents={m.marginCents} signed /><span className="text-xs text-text-muted">{formatPercent(m.marginRate)}</span></span></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination className="mt-3" page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} onPageChange={(p) => set("page", String(p))} />
          </>
        )}
      </QueryBoundary>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nouvelle commande" description="Le coût d'acquisition de l'article est copié dans la commande au moment de la création." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.itemId || !form.customerId || !form.salePriceCents}>Créer</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Article" required>{(p) => <Select id={p.id} value={form.itemId} onChange={(e) => { const it = items.data?.items.find((i) => i.id === e.target.value); setForm({ ...form, itemId: e.target.value, salePriceCents: it?.listedPriceCents ?? form.salePriceCents }); }}><option value="">Choisir…</option>{(items.data?.items ?? []).filter((i) => i.status !== "sold").map((i) => <option key={i.id} value={i.id}>{i.title}{i.sku ? ` (${i.sku})` : ""}</option>)}</Select>}</Field>
          <Field label="Client" required>{(p) => <Select id={p.id} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}><option value="">Choisir…</option>{(customers.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</Select>}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prix de vente" required>{(p) => <MoneyInput id={p.id} value={form.salePriceCents} onChange={(v) => setForm({ ...form, salePriceCents: v })} />}</Field>
            <Field label="Port à charge du vendeur">{(p) => <MoneyInput id={p.id} value={form.shippingCostCents} onChange={(v) => setForm({ ...form, shippingCostCents: v ?? 0 })} />}</Field>
          </div>
          <Field label="Référence externe" hint="Référence de transaction de la marketplace (sert à l'idempotence).">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />}</Field>
          {selectedItem && form.salePriceCents ? <p className="text-sm text-text-muted">Marge brute estimée : <Money cents={orderMargin({ salePriceCents: form.salePriceCents, platformFeeCents: 0, shippingCostCents: form.shippingCostCents ?? 0, otherCostsCents: 0, purchasePriceCents: selectedItem.purchasePriceCents, purchaseFeesCents: selectedItem.purchaseFeesCents }).marginCents} signed /> {selectedItem.floorPriceCents !== null && form.salePriceCents < selectedItem.floorPriceCents ? <Tag accent>sous le plancher</Tag> : null}</p> : null}
        </div>
      </Dialog>
    </>
  );
}
