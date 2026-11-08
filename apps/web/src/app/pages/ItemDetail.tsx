import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, Lightbulb, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, ITEM_STATUS_LABELS, type InventoryItem, type ItemStatus, type PriceEstimate, type PriceStrategies } from "@selio/contracts";
import { ITEM_TRANSITIONS, can, daysInStock, projectedMargin } from "@selio/domain";
import { Button, Card, ConfirmDialog, DescriptionList, Menu, Money, PageHeader, Tag, cn, formatDate, formatDateTime, formatPercent } from "@selio/ui";
import { ScoreRing, scoreTextTone } from "../../components/charts";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { ItemStatusBadge, OrderStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { Finance } from "../components/finance";
import { PriceEstimateView } from "../components/pricing";
import { itemPriceFeatures } from "../../lib/track";
import { ListingChecks, useBlurScores } from "../components/selling";

export default function ItemDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["item", id], queryFn: () => client.getItem(id) });
  const history = useQuery({ queryKey: ["item", id, "history"], queryFn: () => client.itemHistory(id) });
  const convs = useQuery({ queryKey: ["conversations", { itemId: id }], queryFn: () => client.listConversations({ itemId: id, pageSize: 10 }) });
  const orders = useQuery({ queryKey: ["orders", { itemId: id }], queryFn: () => client.listOrders({ itemId: id, pageSize: 10 }) });
  const dressing = useQuery({ queryKey: ["dressing", "item", id], queryFn: async () => (await client.getDressing({})).listings.find((l) => l.item.id === id) ?? null });
  const [photoIndex, setPhotoIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const setStatus = useAppMutation((status: ItemStatus) => client.setItemStatus(id, status), { invalidate: ["item", "items", "overview"], success: "Statut mis à jour" });
  const del = useAppMutation(() => client.deleteItem(id), { invalidate: ["items", "overview"], success: "Article supprimé", onSuccess: () => navigate("/app/items") });
  const canWrite = can(session.role, "items.write");
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
                  {can(session.role, "items.delete") ? <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Supprimer</Button> : null}
                </>
              ) : undefined}
            />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <Card>
                  <div className="grid gap-5 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
                    <div>
                      {it.photos.length === 0 ? <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-surface-muted text-sm text-text-muted" aria-label="Aucune photo">Aucune photo</div> : <img src={it.photos[Math.min(photoIndex, it.photos.length - 1)]!.url} alt={it.photos[Math.min(photoIndex, it.photos.length - 1)]!.alt || it.title} className="aspect-[4/5] w-full rounded-lg bg-surface-muted object-cover" />}
                      {it.photos.length > 1 ? (
                        <div className="mt-2 grid grid-cols-5 gap-1.5">
                          {it.photos.map((p, i) => <button key={p.id} type="button" onClick={() => setPhotoIndex(i)} aria-label={`Photo ${i + 1}`} className={cn("overflow-hidden rounded-md ring-offset-2 ring-offset-surface", i === photoIndex && "ring-2 ring-accent")}><img src={p.url} alt="" className="aspect-square w-full object-cover" /></button>)}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <DescriptionList columns={2} items={[
                        { label: "Marque", value: it.brand ?? "—" },
                        { label: "Taille", value: it.size ?? "—" },
                        { label: "Catégorie", value: ITEM_CATEGORY_LABELS[it.category] },
                        { label: "État", value: ITEM_CONDITION_LABELS[it.condition] },
                        { label: "Acheté le", value: it.purchasedAt ? formatDate(it.purchasedAt) : "—" },
                        { label: "En stock depuis", value: `${daysInStock(it, new Date())} j`, numeric: true },
                        { label: "Couleurs", value: it.attributes.colors.join(", ") || "—" },
                        { label: "Matière", value: it.attributes.material ?? "—" },
                      ]} />
                      {it.description ? <p className="mt-4 text-sm whitespace-pre-line text-text-muted">{it.description}</p> : null}
                    </div>
                  </div>
                </Card>
                {it.status !== "sold" && it.status !== "archived" ? <ItemChecksCard item={it} /> : null}
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
                {dressing.data ? (
                  <Card>
                    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-md font-semibold">Rendement de l'annonce</h2><Link to="/app/dressing" className="text-xs font-medium text-accent">Dressing →</Link></div>
                    <div className="flex items-center gap-4">
                      <ScoreRing score={dressing.data.performance.score} size={64} stroke={6} scale="listing" />
                      <div className="text-sm">
                        <p className="font-semibold" style={{ color: scoreTextTone(dressing.data.performance.score, "listing") }}>{dressing.data.performance.band.label}</p>
                        <p className="num text-xs text-text-muted">{dressing.data.performance.daysOnline} j en ligne · {dressing.data.performance.views} vues · {dressing.data.performance.favorites} favoris · {dressing.data.performance.offers} offre(s)</p>
                        <p className="num text-xs text-text-muted">{dressing.data.plan.usedCount}/{dressing.data.plan.variants.length} variantes de republication utilisées</p>
                      </div>
                    </div>
                    {dressing.data.performance.tips.length ? <ul className="mt-3 flex flex-col gap-1.5 text-xs">{dressing.data.performance.tips.slice(0, 3).map((t) => <li key={t.key} className="flex gap-1.5"><Lightbulb className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden /><span><span className="font-medium text-text">{t.label}</span> <span className="text-text-muted">— {t.detail}</span></span></li>)}</ul> : null}
                    {dressing.data.performance.republishDue ? <Link to="/app/dressing?filter=due"><Button size="sm" variant="accent" className="mt-3" fullWidth>Republier avec la variante {dressing.data.plan.next?.index}</Button></Link> : null}
                  </Card>
                ) : null}
                {it.status !== "sold" && it.status !== "archived" ? <ItemPricePanel item={it} canWrite={canWrite} canExplain={can(session.role, "ai.use")} /> : null}
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Prix et marge</h2>
                  <DescriptionList items={[
                    { label: "Prix d'achat", value: <Finance><Money cents={it.purchasePriceCents} /></Finance>, numeric: true },
                    { label: "Frais d'acquisition", value: <Finance><Money cents={it.purchaseFeesCents} /></Finance>, numeric: true },
                    { label: "Prix affiché", value: it.listedPriceCents === null ? "—" : <Money cents={it.listedPriceCents} />, numeric: true },
                    { label: "Prix plancher", value: it.floorPriceCents === null ? "—" : <Money cents={it.floorPriceCents} />, numeric: true },
                    { label: "Marge projetée", value: <Finance>{margin ? <><Money cents={margin.marginCents} signed /> <span className="text-text-muted">({formatPercent(margin.marginRate)})</span></> : "—"}</Finance>, numeric: true },
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

/** Contrôle des photos (flou calculé sur canvas, dans le navigateur) et des mesures manquantes pour la catégorie. */
function ItemChecksCard({ item }: { item: InventoryItem }) {
  const scores = useBlurScores(item.photos.map((p) => p.url));
  return (
    <Card>
      <ListingChecks item={item} scores={scores} />
      <Link to={`/app/items/${item.id}/edit`} className="mt-2 inline-block text-xs font-medium text-accent hover:underline">Compléter les photos ou la description</Link>
    </Card>
  );
}

/**
 * « Prix conseillé par les ventes réelles » : fourchette, trois stratégies avec « Appliquer » (jamais sous le
 * prix plancher), méthode et confiance ; explication en mots par mon IA perso à la demande (une requête IA).
 */
function ItemPricePanel({ item, canWrite, canExplain }: { item: InventoryItem; canWrite: boolean; canExplain: boolean }) {
  const client = useClient();
  const features = itemPriceFeatures(item);
  const estimate = useQuery({ queryKey: ["price-estimate", "item", item.id, features], queryFn: () => client.estimatePrice(features), staleTime: 60_000 });
  const model = useQuery({ queryKey: ["pricing-model"], queryFn: () => client.pricingModelStatus(), staleTime: 60_000 });
  const [explained, setExplained] = useState<PriceEstimate | null>(null);
  const [applying, setApplying] = useState<keyof PriceStrategies | null>(null);
  const explain = useAppMutation(() => client.estimatePrice({ ...features, explain: true }), {
    invalidate: ["ai-requests", "usage"],
    success: (e) => (e.explanation ? null : "Explication indisponible pour le moment : le prix reste valable."),
    onSuccess: (e) => setExplained(e),
  });
  const apply = useAppMutation((cents: number) => client.updateItem(item.id, { listedPriceCents: cents }), {
    invalidate: ["item", "items", "dressing", "overview"],
    success: "Prix appliqué à l'article",
    onSettled: () => setApplying(null),
  });
  return (
    <Card aria-label="Prix conseillé par les ventes réelles">
      <h2 className="text-md font-semibold">Prix conseillé par les ventes réelles</h2>
      <p className="mb-3 text-xs text-text-muted">Ventes comparables et modèle de prix. Mon IA perso explique le prix, elle ne le choisit jamais.</p>
      <QueryBoundary query={estimate} skeleton="spinner">
        {(e) => {
          const shown = explained ?? e;
          return (
            <PriceEstimateView
              estimate={shown}
              modelStatus={model.data}
              current={item.listedPriceCents}
              floorCents={item.floorPriceCents}
              disabled={!canWrite || apply.isPending}
              applying={applying}
              onApply={canWrite ? (cents, key) => { setApplying(key); apply.mutate(cents); } : undefined}
              explainAction={canExplain && !shown.explanation ? <Button size="sm" variant="ghost" onClick={() => explain.mutate(undefined)} loading={explain.isPending}>Expliquer en mots</Button> : undefined}
            />
          );
        }}
      </QueryBoundary>
    </Card>
  );
}
