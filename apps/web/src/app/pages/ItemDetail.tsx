import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, ITEM_STATUS_LABELS, type ItemStatus } from "@selio/contracts";
import { ITEM_TRANSITIONS, daysInStock, projectedMargin } from "@selio/domain";
import { Button, Card, ConfirmDialog, DescriptionList, Menu, Money, PageHeader, Tag, formatDate, formatDateTime, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { ItemStatusBadge, OrderStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function ItemDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["item", id], queryFn: () => client.getItem(id) });
  const history = useQuery({ queryKey: ["item", id, "history"], queryFn: () => client.itemHistory(id) });
  const convs = useQuery({ queryKey: ["conversations", { itemId: id }], queryFn: () => client.listConversations({ itemId: id, pageSize: 10 }) });
  const orders = useQuery({ queryKey: ["orders", { itemId: id }], queryFn: () => client.listOrders({ itemId: id, pageSize: 10 }) });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const setStatus = useAppMutation((status: ItemStatus) => client.setItemStatus(id, status), { invalidate: ["item", "items", "overview"], success: "Statut mis à jour" });
  const del = useAppMutation(() => client.deleteItem(id), { invalidate: ["items", "overview"], success: "Article supprimé", onSuccess: () => navigate("/app/items") });
  const canWrite = session.role !== "viewer";
  const rules = session.org.settings.margin;
  return (
    <QueryBoundary query={q} skeleton="spinner">
      {(it) => {
        const margin = projectedMargin(it, rules);
        const transitions = ITEM_TRANSITIONS[it.status];
        return (
          <>
            <PageHeader
              eyebrow={<Link to="/app/items" className="hover:text-text">Articles et stock</Link>}
              title={it.title}
              description={<span className="flex flex-wrap items-center gap-2"><ItemStatusBadge status={it.status} />{it.sku ? <Tag>{it.sku}</Tag> : null}{it.tags.map((t) => <Tag key={t}>{t}</Tag>)}</span>}
              actions={canWrite ? (
                <>
                  <Menu
                    trigger={({ toggle, open, id: mid }) => <Button variant="secondary" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={mid}>Changer le statut</Button>}
                    items={transitions.map((s) => ({ label: ITEM_STATUS_LABELS[s], onSelect: () => setStatus.mutate(s), icon: s === "archived" ? <Archive /> : s === "in_stock" && it.status === "archived" ? <RotateCcw /> : undefined }))}
                  />
                  <Link to={`/app/items/${id}/edit`}><Button icon={<Pencil />}>Modifier</Button></Link>
                  {session.role === "owner" || session.role === "admin" ? <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Supprimer</Button> : null}
                </>
              ) : undefined}
            />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <Card>
                  <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                      {it.photos.length === 0 ? <div className="aspect-square rounded-md bg-surface-muted" aria-label="Aucune photo" /> : it.photos.map((p) => <img key={p.id} src={p.url} alt={p.alt || it.title} className="aspect-square rounded-md bg-surface-muted object-cover" />)}
                    </div>
                    <div>
                      <DescriptionList columns={2} items={[
                        { label: "Marque", value: it.brand ?? "—" },
                        { label: "Taille", value: it.size ?? "—" },
                        { label: "Catégorie", value: ITEM_CATEGORY_LABELS[it.category] },
                        { label: "État", value: ITEM_CONDITION_LABELS[it.condition] },
                        { label: "Acheté le", value: it.purchasedAt ? formatDate(it.purchasedAt) : "—" },
                        { label: "En stock depuis", value: `${daysInStock(it, new Date())} j`, numeric: true },
                      ]} />
                      {it.description ? <p className="mt-4 text-sm whitespace-pre-line text-text-muted">{it.description}</p> : null}
                    </div>
                  </div>
                </Card>
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Conversations liées</h2>
                  {convs.data?.items.length ? (
                    <ul className="divide-y divide-border">
                      {convs.data.items.map((c) => (
                        <li key={c.id}><Link to={`/app/messages/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent"><span className="min-w-0"><span className="block font-medium">{c.customer.displayName}</span><span className="block truncate text-text-muted">{c.lastMessagePreview}</span></span>{c.unreadCount > 0 ? <Tag accent>{c.unreadCount} non lu(s)</Tag> : null}</Link></li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-text-muted">Aucune conversation pour cet article.</p>}
                </Card>
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Commandes</h2>
                  {orders.data?.items.length ? (
                    <ul className="divide-y divide-border">
                      {orders.data.items.map((o) => (
                        <li key={o.id}><Link to={`/app/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent"><span><span className="block font-medium">{o.customer?.displayName ?? "Client"}</span><span className="block text-text-muted">{formatDate(o.createdAt)}</span></span><span className="flex items-center gap-2"><OrderStatusBadge status={o.status} /><Money cents={o.salePriceCents} /></span></Link></li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-text-muted">Aucune commande.</p>}
                </Card>
              </div>
              <div className="flex flex-col gap-4">
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Prix et marge</h2>
                  <DescriptionList items={[
                    { label: "Prix d'achat", value: <Money cents={it.purchasePriceCents} />, numeric: true },
                    { label: "Frais d'acquisition", value: <Money cents={it.purchaseFeesCents} />, numeric: true },
                    { label: "Prix affiché", value: it.listedPriceCents === null ? "—" : <Money cents={it.listedPriceCents} />, numeric: true },
                    { label: "Prix plancher", value: it.floorPriceCents === null ? "—" : <Money cents={it.floorPriceCents} />, numeric: true },
                    { label: "Marge projetée", value: margin ? <><Money cents={margin.marginCents} signed /> <span className="text-text-muted">({formatPercent(margin.marginRate)})</span></> : "—", numeric: true },
                  ]} />
                  <p className="mt-3 text-xs text-text-muted">Marge projetée = prix affiché − frais plateforme par défaut − port vendeur par défaut − coût d'acquisition.</p>
                </Card>
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Historique</h2>
                  {history.data?.length ? (
                    <ol className="flex flex-col gap-3">
                      {history.data.map((e) => (
                        <li key={e.id} className="text-sm">
                          <p className="font-medium text-text">{labelFor(e.kind)}{e.note ? ` · ${e.note}` : ""}</p>
                          <p className="text-xs text-text-muted">{formatDateTime(e.createdAt)}</p>
                          {Object.keys(e.changes).length > 0 ? (
                            <ul className="mt-1 text-xs text-text-muted">
                              {Object.entries(e.changes).slice(0, 6).map(([k, v]) => <li key={k} className="num">{k} : {fmt(v.from)} → {fmt(v.to)}</li>)}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-sm text-text-muted">Aucune modification enregistrée.</p>}
                </Card>
              </div>
            </div>
            <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => del.mutate()} loading={del.isPending} danger title="Supprimer cet article ?" description="Suppression définitive. Si l'article est lié à une commande, préférez l'archivage." confirmLabel="Supprimer" typeToConfirm="SUPPRIMER" typed={typed} onTypedChange={setTyped} />
          </>
        );
      }}
    </QueryBoundary>
  );
  function labelFor(kind: string): string {
    return ({ created: "Création", updated: "Modification", status_changed: "Changement de statut", price_changed: "Changement de prix", imported: "Import", archived: "Archivage", restored: "Restauration", captured: "Capture via l'extension" } as Record<string, string>)[kind] ?? kind;
  }
  function fmt(v: unknown): string {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  }
}
