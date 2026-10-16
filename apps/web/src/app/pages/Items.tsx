import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, CalendarClock, Download, LayoutGrid, List, Plus, Search, Sparkles, Upload } from "lucide-react";
import { ITEM_CATEGORY_LABELS, ITEM_CATEGORIES, type InventoryItem, type InventoryQuery, type ItemStatus } from "@selio/contracts";
import { daysInStock, daysOnline, projectedMargin } from "@selio/domain";
import { Button, Checkbox, ConfirmDialog, EmptyState, FilterChip, Input, Money, PageHeader, Pagination, Select, Table, TableEmpty, TableWrap, Td, Th, Tr, cn, formatCents, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { downloadFile } from "../../lib/download";
import { ItemStatusBadge, ItemThumb, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Items() {
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query: Partial<InventoryQuery> = {
    q: params.get("q") ?? undefined,
    status: (params.get("status") as ItemStatus) || undefined,
    category: (params.get("category") as InventoryQuery["category"]) || undefined,
    brand: params.get("brand") || undefined,
    sort: (params.get("sort") as InventoryQuery["sort"]) || "updated_desc",
    minDaysOnline: params.get("online") ? Number(params.get("online")) : undefined,
    page: Number(params.get("page") ?? 1),
    pageSize: 24,
  };
  const [view, setViewState] = useState<"grid" | "table">(() => { try { return localStorage.getItem("selio.items.view") === "table" ? "table" : "grid"; } catch { return "grid"; } });
  const setView = (v: "grid" | "table") => { setViewState(v); try { localStorage.setItem("selio.items.view", v); } catch { /* ignore */ } };
  const counts = useQuery({ queryKey: ["items", "status-counts"], queryFn: async () => {
    const statuses: (ItemStatus | "")[] = ["", "in_stock", "listed", "reserved", "sold", "archived"];
    const res = await Promise.all(statuses.map((st) => client.listItems({ status: st || undefined, pageSize: 1 })));
    return Object.fromEntries(statuses.map((st, i) => [st || "all", res[i]!.total])) as Record<string, number>;
  } });
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };
  const q = useQuery({ queryKey: ["items", query], queryFn: () => client.listItems(query) });
  const brands = useQuery({ queryKey: ["items", "brands"], queryFn: () => client.listItemBrands() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ action: "archive" | "delete" | "list" } | null>(null);
  const bulk = useAppMutation((action: "archive" | "delete" | "list") => client.bulkItems(action === "list" ? { ids: [...selected], action: "set_status", status: "listed" } : { ids: [...selected], action }), { invalidate: ["items", "overview"], success: (r) => `${r.affected} article(s) modifié(s)`, onSuccess: () => { setSelected(new Set()); setConfirm(null); } });
  const exportCsv = useAppMutation(() => client.exportItemsCsv(), { success: "Export CSV généré", onSuccess: (csv) => downloadFile(`selio-articles-${new Date().toISOString().slice(0, 10)}.csv`, csv) });
  const rules = session.org.settings.margin;
  const canWrite = session.role !== "viewer";
  const allIds = useMemo(() => q.data?.items.map((i) => i.id) ?? [], [q.data]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  return (
    <>
      <PageHeader
        title="Articles et stock"
        description="Tout votre stock en un coup d'œil : brouillons, articles en vente, réservés et vendus. Prix d'achat, prix affiché, plancher et marge projetée sont calculés avec vos règles."
        actions={
          <>
            <Button variant="secondary" icon={<Download />} onClick={() => exportCsv.mutate(undefined)} loading={exportCsv.isPending}>Exporter CSV</Button>
            {canWrite ? <Link to="/app/items/import"><Button variant="secondary" icon={<Upload />}>Importer</Button></Link> : null}
            {canWrite ? <Link to="/app/items/new"><Button variant="secondary" icon={<Plus />}>Nouvel article</Button></Link> : null}
            {canWrite ? <Link to="/app/studio"><Button variant="brand" icon={<Sparkles />}>Générer avec l'IA</Button></Link> : null}
          </>
        }
      />
      <div role="tablist" aria-label="Statut" className="mb-4 flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
        {([["", "Tous actifs"], ["in_stock", "Brouillons / en stock"], ["listed", "En vente"], ["reserved", "Réservés"], ["sold", "Vendus"], ["archived", "Archivés"]] as const).map(([value, label]) => (
          <FilterChip key={value || "all"} role="tab" active={(query.status ?? "") === value} onClick={() => set("status", value)} count={counts.data ? counts.data[value || "all"] ?? 0 : null}>{label}</FilterChip>
        ))}
      </div>
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
        <Input placeholder="Rechercher titre, marque, SKU, tag…" prefix={<Search />} value={query.q ?? ""} onChange={(e) => set("q", e.target.value)} aria-label="Recherche" />
        <Select value={query.category ?? ""} onChange={(e) => set("category", e.target.value)} aria-label="Catégorie">
          <option value="">Catégories</option>
          {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}
        </Select>
        <Select value={query.brand ?? ""} onChange={(e) => set("brand", e.target.value)} aria-label="Marque">
          <option value="">Marques</option>
          {(brands.data ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
        </Select>
        <Select value={params.get("online") ?? ""} onChange={(e) => set("online", e.target.value)} aria-label="En ligne depuis">
          <option value="">En ligne : tous</option>
          <option value="7">En ligne depuis 7 j ou plus</option>
          <option value="14">14 j ou plus</option>
          <option value="30">30 j ou plus</option>
        </Select>
        <Select value={query.sort} onChange={(e) => set("sort", e.target.value)} aria-label="Tri">
          <option value="updated_desc">Récemment modifiés</option>
          <option value="created_desc">Plus récents</option>
          <option value="online_desc">Plus longtemps en ligne</option>
          <option value="title_asc">Titre A→Z</option>
          <option value="price_desc">Prix décroissant</option>
          <option value="price_asc">Prix croissant</option>
          <option value="margin_desc">Marge projetée</option>
        </Select>
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="radiogroup" aria-label="Affichage">
          <button type="button" role="radio" aria-checked={view === "grid"} aria-label="Grille" title="Grille" onClick={() => setView("grid")} className={cn("inline-flex h-8 w-9 items-center justify-center rounded-sm", view === "grid" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text")}><LayoutGrid className="size-4" /></button>
          <button type="button" role="radio" aria-checked={view === "table"} aria-label="Liste" title="Liste" onClick={() => setView("table")} className={cn("inline-flex h-8 w-9 items-center justify-center rounded-sm", view === "table" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text")}><List className="size-4" /></button>
        </div>
      </div>
      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span className="num font-medium">{selected.size} sélectionné(s)</span>
          <Button size="sm" variant="secondary" onClick={() => setConfirm({ action: "list" })}>Mettre en vente</Button>
          <Button size="sm" variant="secondary" icon={<Archive />} onClick={() => setConfirm({ action: "archive" })}>Archiver</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm({ action: "delete" })}>Supprimer</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Annuler</Button>
        </div>
      ) : null}
      <QueryBoundary query={q} empty={(d) => d.total === 0 && !query.q && !query.status && !query.category ? <EmptyState title="Aucun article" description="Créez votre premier article ou importez un fichier CSV." action={canWrite ? <Link to="/app/items/new"><Button icon={<Plus />}>Nouvel article</Button></Link> : undefined} /> : null}>
        {(d) => (
          <>
            {view === "grid" ? (
              d.items.length === 0 ? <EmptyState title="Aucun article ne correspond aux filtres." /> : (
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {d.items.map((it) => <ItemCard key={it.id} item={it} rules={rules} selected={selected.has(it.id)} canWrite={canWrite} onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(it.id); else n.delete(it.id); return n; })} />)}
                </div>
              )
            ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    {canWrite ? <Th className="w-10"><Checkbox aria-label="Tout sélectionner" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(allIds) : new Set())} /></Th> : null}
                    <Th>Article</Th>
                    <Th>Statut</Th>
                    <Th className="hide-mobile">Taille</Th>
                    <Th numeric>Achat</Th>
                    <Th numeric>Affiché</Th>
                    <Th numeric>Plancher</Th>
                    <Th numeric>Marge projetée</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.length === 0 ? <TableEmpty colSpan={8}>Aucun article ne correspond aux filtres.</TableEmpty> : d.items.map((it) => <Row key={it.id} item={it} rules={rules} selected={selected.has(it.id)} canWrite={canWrite} onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(it.id); else n.delete(it.id); return n; })} onOpen={() => navigate(`/app/items/${it.id}`)} />)}
                </tbody>
              </Table>
            </TableWrap>
            )}
            <Pagination className="mt-3" page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} onPageChange={(p) => set("page", String(p))} />
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && bulk.mutate(confirm.action)}
        loading={bulk.isPending}
        danger={confirm?.action === "delete"}
        title={confirm?.action === "delete" ? `Supprimer ${selected.size} article(s) ?` : confirm?.action === "archive" ? `Archiver ${selected.size} article(s) ?` : `Mettre ${selected.size} article(s) en vente ?`}
        description={confirm?.action === "delete" ? "Suppression définitive. Les articles liés à une commande ne seront pas supprimés." : confirm?.action === "archive" ? "Les articles archivés n'apparaissent plus dans le stock actif et peuvent être restaurés." : "Le statut passe à « En vente ». Les articles vendus ou archivés ne sont pas concernés."}
        confirmLabel={confirm?.action === "delete" ? "Supprimer" : "Confirmer"}
      />
    </>
  );
}

function Row({ item, rules, selected, canWrite, onSelect, onOpen }: { item: InventoryItem; rules: ReturnType<typeof useRequiredSession>["org"]["settings"]["margin"]; selected: boolean; canWrite: boolean; onSelect: (v: boolean) => void; onOpen: () => void }) {
  const m = projectedMargin(item, rules);
  return (
    <Tr interactive selected={selected} tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      {canWrite ? <Td onClick={(e) => e.stopPropagation()}><Checkbox aria-label={`Sélectionner ${item.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></Td> : null}
      <Td>
        <span className="flex items-center gap-3">
          <ItemThumb photos={item.photos} title={item.title} size={48} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-text">{item.title}</span>
            <span className="block truncate text-xs text-text-muted">{[item.brand, item.sku].filter(Boolean).join(" · ")}</span>
          </span>
        </span>
      </Td>
      <Td><ItemStatusBadge status={item.status} /></Td>
      <Td className="hide-mobile text-text-muted">{item.size ?? "—"}</Td>
      <Td numeric><Money cents={item.purchasePriceCents + item.purchaseFeesCents} /></Td>
      <Td numeric>{item.listedPriceCents === null ? <span className="text-text-muted">—</span> : <Money cents={item.listedPriceCents} />}</Td>
      <Td numeric>{item.floorPriceCents === null ? <span className="text-text-muted">—</span> : <Money cents={item.floorPriceCents} />}</Td>
      <Td numeric>{m ? <span className="inline-flex flex-col items-end"><Money cents={m.marginCents} signed /><span className="text-xs text-text-muted">{formatPercent(m.marginRate)}</span></span> : <span className="text-text-muted">—</span>}</Td>
    </Tr>
  );
}

function ItemCard({ item, rules, selected, canWrite, onSelect }: { item: InventoryItem; rules: ReturnType<typeof useRequiredSession>["org"]["settings"]["margin"]; selected: boolean; canWrite: boolean; onSelect: (v: boolean) => void }) {
  const m = projectedMargin(item, rules);
  const now = new Date();
  const online = daysOnline(item, now);
  return (
    <article className={cn("card group relative flex flex-col overflow-hidden transition-colors hover:border-border-strong", selected && "border-accent ring-1 ring-accent")}>
      <Link to={`/app/items/${item.id}`} className="relative block aspect-[4/5] bg-surface-muted">
        {item.photos[0] ? <img src={item.photos[0].url} alt={item.photos[0].alt || item.title} loading="lazy" className="size-full object-cover" /> : null}
        <span className="absolute top-2.5 left-2.5"><ItemStatusBadge status={item.status} /></span>
        {online !== null && (item.status === "listed" || item.status === "reserved") ? <span className={cn("absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 text-[11px] font-medium shadow-sm", online >= 7 ? "text-accent" : "text-text-muted")}><CalendarClock className="size-3" aria-hidden />{online} j en ligne</span> : null}
      </Link>
      {canWrite ? <span className={cn("absolute top-2.5 right-2.5 rounded-md bg-surface/90 p-1 transition-opacity", selected ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100")}><Checkbox aria-label={`Sélectionner ${item.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></span> : null}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link to={`/app/items/${item.id}`} className="line-clamp-2 text-sm leading-snug font-medium text-text hover:text-accent">{item.title}</Link>
        <p className="truncate text-xs text-text-muted">{[item.brand, item.size, item.sku].filter(Boolean).join(" · ")}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="num text-base font-semibold">{item.listedPriceCents !== null ? formatCents(item.listedPriceCents) : <span className="text-sm font-normal text-text-muted">Sans prix</span>}</span>
          {m ? <span className={cn("num text-xs font-medium", m.marginCents >= 0 ? "text-success" : "text-danger")}>{m.marginCents >= 0 ? "+" : ""}{formatCents(m.marginCents)} · {formatPercent(m.marginRate)}</span> : null}
        </div>
        <p className="num text-[11px] text-text-muted">Achat <Money cents={item.purchasePriceCents + item.purchaseFeesCents} /> · {daysInStock(item, now)} j en stock</p>
      </div>
    </article>
  );
}
