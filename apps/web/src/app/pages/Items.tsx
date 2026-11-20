import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, Download, ImageOff, Layers, LayoutGrid, List, Percent, Plus, RefreshCw, Search, Sparkles, Tags, Trash2, Upload, X } from "lucide-react";
import { ITEM_CATEGORY_LABELS, ITEM_CATEGORIES, ITEM_STATUS_LABELS, type BulkItemAction, type InventoryItem, type ItemStatus } from "@selio/contracts";
import { can, parseEuroInput } from "@selio/domain";
import { Button, Checkbox, EmptyState, FilterChip, Input, Kbd, PageHeader, Pagination, Select, StatStrip, Table, TableEmpty, TableWrap, Th, buttonClass, cn, formatCents, formatNumber, useToast } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { downloadFile } from "../../lib/download";
import { errorMessage } from "../../lib/errors";
import { MARGIN_FILTER_LABELS, activeItemFilters, itemsKeyAction, itemsQueryFromParams } from "../../lib/items-view";
import { QueryBoundary } from "../components/common";
import { FinanceMaskedNote, MaskedAmount, useSeesFinances } from "../components/finance";
import { useAppMutation, useDebouncedValue } from "../components/hooks";
import { ItemCard, ItemMobileRow, ItemRow } from "../components/items-list";

/**
 * Articles et stock (Selio Manager) : compteurs en tête, recherche instantanée (« / »), filtres rapides en
 * puces, tri, vue grille ou liste, édition rapide du prix et du statut, sélection multiple et actions groupées
 * (statut, prix, republication, archivage, suppression confirmée dans la page), « n » pour un nouvel article.
 * Filtres dans l'adresse : la vue se partage et se retrouve au retour d'une fiche.
 */

const STATUS_TABS: readonly [ItemStatus | "", string][] = [["", "Tous actifs"], ["in_stock", "En stock"], ["listed", "En vente"], ["reserved", "Réservés"], ["sold", "Vendus"], ["archived", "Archivés"]];
type View = "grid" | "table";
type PriceMode = "set" | "adjust";

export default function Items() {
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const query = itemsQueryFromParams(params);
  const finances = useSeesFinances();
  const canWrite = can(session.role, "items.write");
  const canDelete = can(session.role, "items.delete");
  // Export : contient les prix d'achat (finances) ; réservé au titulaire et aux administrateurs.
  const canExport = can(session.role, "analytics.export");
  const rules = session.org.settings.margin;

  const [view, setViewState] = useState<View>(() => { try { return localStorage.getItem("selio.items.view") === "table" ? "table" : "grid"; } catch { return "grid"; } });
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem("selio.items.view", v); } catch { /* stockage indisponible */ } };

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };
  const toggle = (k: string, v: string) => set(k, params.get(k) === v ? "" : v);

  // Recherche instantanée : le champ suit la frappe, l'adresse (et la requête) suit 200 ms plus tard.
  const [search, setSearch] = useState(query.q ?? "");
  const debounced = useDebouncedValue(search, 200);
  useEffect(() => { if ((params.get("q") ?? "") !== debounced) set("q", debounced); }, [debounced]);
  const searchRef = useRef<HTMLInputElement>(null);

  const q = useQuery({ queryKey: ["items", query], queryFn: () => client.listItems(query), placeholderData: (prev) => prev });
  const summary = useQuery({ queryKey: ["items", "summary"], queryFn: () => client.itemSummary() });
  const counts = useQuery({ queryKey: ["items", "status-counts"], queryFn: async () => {
    const statuses: (ItemStatus | "")[] = ["", "in_stock", "listed", "reserved", "sold", "archived"];
    const res = await Promise.all(statuses.map((st) => client.listItems({ status: st || undefined, pageSize: 1 })));
    return Object.fromEntries(statuses.map((st, i) => [st || "all", res[i]!.total])) as Record<string, number>;
  } });
  const brands = useQuery({ queryKey: ["items", "brands"], queryFn: () => client.listItemBrands() });
  const accounts = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections(), enabled: can(session.role, "connections.read") });
  const accountNames = useMemo(() => Object.fromEntries((accounts.data ?? []).map((c) => [c.id, c.label])), [accounts.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [priceMode, setPriceMode] = useState<PriceMode | null>(null);
  const [priceText, setPriceText] = useState("");
  const select = (id: string, v: boolean) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  const clearSelection = () => { setSelected(new Set()); setConfirmDelete(false); setPriceMode(null); };

  // Raccourcis clavier : « / » cherche, « n » crée un article, Échap vide la sélection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = itemsKeyAction(e);
      if (action === "search") { e.preventDefault(); searchRef.current?.focus(); }
      else if (action === "new" && canWrite) { e.preventDefault(); void navigate("/app/items/new"); }
      else if (action === "clear" && document.activeElement === searchRef.current && search) { setSearch(""); }
      else if (action === "clear" && !document.querySelector("[role=dialog]")) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWrite, navigate, search]);

  const bulk = useAppMutation((action: BulkItemAction) => client.bulkItems(action), {
    invalidate: ["items", "overview", "activity", "dressing"],
    success: (r) => (r.affected === 0 ? "Aucun article modifié (statut ou prix déjà à jour, ou action impossible)" : `${r.affected} article(s) modifié(s)`),
    onSuccess: () => clearSelection(),
  });
  const runBulk = (patch: Omit<BulkItemAction, "ids">) => bulk.mutate({ ids: [...selected], ...patch } as BulkItemAction);
  const quick = useAppMutation(({ id, patch }: { id: string; patch: { status?: ItemStatus; listedPriceCents?: number | null } }) => (patch.status ? client.setItemStatus(id, patch.status) : client.updateItem(id, { listedPriceCents: patch.listedPriceCents ?? null })), {
    invalidate: ["items", "overview", "activity"],
    success: (it: InventoryItem) => `« ${it.title} » mis à jour`,
  });
  const exportCsv = useAppMutation(() => client.exportItemsCsv(), { success: "Export CSV généré", onSuccess: (csv) => downloadFile(`selio-articles-${new Date().toISOString().slice(0, 10)}.csv`, csv) });

  const allIds = useMemo(() => q.data?.items.map((i) => i.id) ?? [], [q.data]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const filters = activeItemFilters(params, { accounts: accountNames });
  const anyFilter = filters.length > 0 || Boolean(query.q) || Boolean(query.status);
  const republishDays = summary.data?.republishAfterDays ?? session.org.settings.dressing.republishAfterDays;

  const submitPrice = () => {
    if (priceMode === "set") {
      const cents = parseEuroInput(priceText);
      if (cents === null) { toast({ tone: "danger", title: "Prix invalide", description: "Exemple : 25 ou 24,90" }); return; }
      runBulk({ action: "set_price", listedPriceCents: cents });
    } else if (priceMode === "adjust") {
      const rate = Number(priceText.replace(",", ".").replace("%", "").trim()) / 100;
      if (!Number.isFinite(rate) || rate === 0 || Math.abs(rate) > 0.5) { toast({ tone: "danger", title: "Pourcentage invalide", description: "Entre −50 et +50 %, par exemple −10." }); return; }
      runBulk({ action: "adjust_price", priceRate: rate });
    }
  };

  const lineProps = (it: InventoryItem) => ({
    item: it,
    selected: selected.has(it.id),
    canWrite,
    busy: quick.isPending && quick.variables?.id === it.id,
    onSelect: (v: boolean) => select(it.id, v),
    onStatus: (status: ItemStatus) => quick.mutate({ id: it.id, patch: { status } }),
    onPrice: (cents: number | null) => quick.mutate({ id: it.id, patch: { listedPriceCents: cents } }),
  });

  return (
    <>
      <PageHeader
        title="Articles et stock"
        description="Tout votre stock en un coup d'œil. Cherchez, filtrez, modifiez un prix ou un statut sans quitter la liste, et agissez sur plusieurs articles d'un coup."
        actions={
          <>
            {canExport ? <Button variant="secondary" icon={<Download />} onClick={() => exportCsv.mutate(undefined)} loading={exportCsv.isPending}>Exporter CSV</Button> : null}
            <Link to="/app/items/lots" className={buttonClass({ variant: "secondary" })}><Layers className="size-4" aria-hidden />Lots intelligents</Link>
            {canWrite ? <Link to="/app/items/import" className={buttonClass({ variant: "secondary" })}><Upload className="size-4" aria-hidden />Importer</Link> : null}
            {canWrite ? <Link to="/app/items/new" className={buttonClass({ variant: "secondary" })} title="Raccourci : n"><Plus className="size-4" aria-hidden />Nouvel article</Link> : null}
            {canWrite ? <Link to="/studio" className={buttonClass({ variant: "brand" })}><Sparkles className="size-4 text-gold-300" aria-hidden />Générer avec Studio</Link> : null}
          </>
        }
      />
      <FinanceMaskedNote />

      <StatStrip
        className="mb-5 grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "En stock", value: summary.data ? formatNumber(summary.data.inStock) : "—", sub: summary.data ? <>{formatNumber(summary.data.withoutPhoto)} sans photo</> : undefined },
          { label: "En ligne", value: summary.data ? formatNumber(summary.data.listed + summary.data.reserved) : "—", sub: summary.data ? <>{formatCents(summary.data.listedValueCents, { compact: true })} affichés · {summary.data.reserved} réservé(s)</> : undefined },
          { label: "Vendus ce mois", value: summary.data ? formatNumber(summary.data.soldThisMonth) : "—", sub: <Link to="/app/orders" className="text-accent hover:underline">Voir les commandes</Link> },
          { label: "Valeur du stock", value: !finances ? <MaskedAmount /> : summary.data?.stockValueCents != null ? formatCents(summary.data.stockValueCents, { compact: true }) : "—", sub: finances ? "au prix d'achat, frais compris" : undefined },
        ]}
      />

      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          ref={searchRef}
          type="search"
          className="md:flex-1"
          placeholder="Rechercher : titre, marque, référence, étiquette…"
          prefix={<Search />}
          suffix={search ? undefined : <Kbd>/</Kbd>}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Recherche"
          aria-keyshortcuts="/"
        />
        <div className="flex items-center gap-2">
          <Select value={query.sort} onChange={(e) => set("sort", e.target.value)} aria-label="Tri" className="min-w-0 flex-1 md:w-52">
            <option value="updated_desc">Récemment modifiés</option>
            <option value="created_desc">Plus récents</option>
            <option value="online_desc">Plus longtemps en ligne</option>
            <option value="title_asc">Titre A→Z</option>
            <option value="price_desc">Prix décroissant</option>
            <option value="price_asc">Prix croissant</option>
            {finances ? <option value="margin_desc">Marge projetée</option> : null}
          </Select>
          <div className="inline-flex shrink-0 rounded-md border border-border bg-surface p-0.5" role="radiogroup" aria-label="Affichage">
            <button type="button" role="radio" aria-checked={view === "grid"} aria-label="Grille" title="Grille" onClick={() => setView("grid")} className={cn("inline-flex h-8 w-9 items-center justify-center rounded-sm max-md:h-10 max-md:w-11", view === "grid" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text")}><LayoutGrid className="size-4" /></button>
            <button type="button" role="radio" aria-checked={view === "table"} aria-label="Liste" title="Liste" onClick={() => setView("table")} className={cn("inline-flex h-8 w-9 items-center justify-center rounded-sm max-md:h-10 max-md:w-11", view === "table" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text")}><List className="size-4" /></button>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Statut" className="mb-2 flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
        {STATUS_TABS.map(([value, label]) => (
          <FilterChip key={value || "all"} role="tab" active={(query.status ?? "") === value} onClick={() => set("status", value)} count={counts.data ? counts.data[value || "all"] ?? 0 : null}>{label}</FilterChip>
        ))}
      </div>
      <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center">
        <div role="group" aria-label="Filtres rapides" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin xl:flex-1 xl:pb-0">
          <FilterChip role="radio" active={params.get("online") === String(republishDays)} onClick={() => toggle("online", String(republishDays))} icon={<RefreshCw />} count={summary.data?.toRepublish ?? null}>À republier</FilterChip>
          <FilterChip role="radio" active={params.get("photos") === "none"} onClick={() => toggle("photos", "none")} icon={<ImageOff />} count={summary.data?.withoutPhoto ?? null}>Sans photo</FilterChip>
          {finances ? (["negative", "low", "good"] as const).map((m) => <FilterChip key={m} role="radio" active={params.get("margin") === m} onClick={() => toggle("margin", m)} icon={<Percent />}>{MARGIN_FILTER_LABELS[m]}</FilterChip>) : null}
        </div>
        <div className={cn("grid shrink-0 gap-2 xl:flex", (accounts.data ?? []).length > 0 ? "grid-cols-3" : "grid-cols-2")}>
          <Select value={query.category ?? ""} onChange={(e) => set("category", e.target.value)} aria-label="Catégorie" className="min-w-0 xl:w-32">
            <option value="">Catégorie</option>
            {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}
          </Select>
          <Select value={query.brand ?? ""} onChange={(e) => set("brand", e.target.value)} aria-label="Marque" className="min-w-0 xl:w-32">
            <option value="">Marque</option>
            {(brands.data ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          {(accounts.data ?? []).length > 0 ? (
            <Select value={query.connectionId ?? ""} onChange={(e) => set("account", e.target.value)} aria-label="Compte Vinted" className="min-w-0 xl:w-32">
              <option value="">Compte</option>
              {(accounts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          ) : null}
        </div>
      </div>
      {filters.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm" aria-label="Filtres actifs">
          {filters.map((f) => (
            <button key={f.key} type="button" onClick={() => set(f.key, "")} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-text hover:bg-surface-muted" aria-label={`Retirer le filtre ${f.label}`}>{f.label}<X className="size-3" aria-hidden /></button>
          ))}
          <button type="button" className="px-1 text-xs font-medium text-accent hover:underline" onClick={() => { setSearch(""); setParams(new URLSearchParams(), { replace: true }); }}>Effacer les filtres</button>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <section aria-label="Actions groupées" className="sticky top-2 z-20 mb-3 rounded-lg border border-accent/40 bg-surface p-2.5 shadow-md max-md:bottom-[calc(env(safe-area-inset-bottom)+12px)] max-md:top-auto max-md:fixed max-md:inset-x-3 max-md:mb-0">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="num mr-1 font-semibold">{selected.size} sélectionné(s)</span>
            <Select aria-label="Changer le statut" value="" disabled={bulk.isPending} onChange={(e) => e.target.value && runBulk({ action: "set_status", status: e.target.value as ItemStatus })} className="w-48">
              <option value="">Changer le statut…</option>
              {(["in_stock", "listed", "reserved", "sold"] as const).map((s) => <option key={s} value={s}>{ITEM_STATUS_LABELS[s]}</option>)}
            </Select>
            <Button size="sm" variant="secondary" icon={<Tags />} onClick={() => { setPriceMode(priceMode ? null : "set"); setPriceText(""); setConfirmDelete(false); }} aria-expanded={priceMode !== null}>Prix</Button>
            <Button size="sm" variant="secondary" icon={<RefreshCw />} loading={bulk.isPending && bulk.variables?.action === "republish"} onClick={() => runBulk({ action: "republish" })}>Republier</Button>
            <Button size="sm" variant="secondary" icon={<Archive />} onClick={() => runBulk({ action: "archive" })}>Archiver</Button>
            {canDelete ? <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { setConfirmDelete(true); setPriceMode(null); }}>Supprimer</Button> : null}
            <Button size="sm" variant="ghost" onClick={clearSelection}>Annuler</Button>
          </div>
          {priceMode ? (
            <form className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm" onSubmit={(e) => { e.preventDefault(); submitPrice(); }}>
              <div role="radiogroup" aria-label="Type de changement de prix" className="flex gap-1">
                <FilterChip active={priceMode === "set"} onClick={() => setPriceMode("set")}>Fixer à</FilterChip>
                <FilterChip active={priceMode === "adjust"} onClick={() => setPriceMode("adjust")}>Ajuster de</FilterChip>
              </div>
              <Input autoFocus value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" aria-label={priceMode === "set" ? "Nouveau prix (€)" : "Ajustement (%)"} placeholder={priceMode === "set" ? "25,00" : "-10"} suffix={<span className="text-sm">{priceMode === "set" ? "€" : "%"}</span>} className="w-32" />
              <Button size="sm" type="submit" loading={bulk.isPending}>Appliquer</Button>
              <span className="text-xs text-text-muted">{priceMode === "adjust" ? "Arrondi à 10 centimes, jamais sous le prix plancher." : "Prix affiché sur Vinted."}</span>
            </form>
          ) : null}
          {confirmDelete ? (
            <div role="alertdialog" aria-label="Confirmer la suppression" className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
              <p className="min-w-0 flex-1 text-text"><strong>Supprimer {selected.size} article(s) ?</strong> <span className="text-text-muted">Suppression définitive. Les articles liés à une commande sont gardés : archivez-les plutôt.</span></p>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Garder</Button>
              <button type="button" className={buttonClass({ size: "sm", className: "bg-danger text-white hover:brightness-110" })} disabled={bulk.isPending} onClick={() => runBulk({ action: "delete" })}>Supprimer définitivement</button>
            </div>
          ) : null}
        </section>
      ) : null}

      <QueryBoundary
        query={q}
        empty={(d) => (d.total === 0 && !anyFilter ? (
          <EmptyState
            icon={<Layers />}
            title="Votre stock est vide"
            description="Trois façons de commencer : ajoutez un article à la main, importez votre tableur, ou laissez Studio rédiger l'annonce à partir de vos photos."
            action={canWrite ? <div className="flex flex-wrap justify-center gap-2"><Link to="/app/items/new" className={buttonClass({})}><Plus className="size-4" aria-hidden />Nouvel article</Link><Link to="/app/items/import" className={buttonClass({ variant: "secondary" })}><Upload className="size-4" aria-hidden />Importer un CSV</Link><Link to="/studio" className={buttonClass({ variant: "brand" })}><Sparkles className="size-4 text-gold-300" aria-hidden />Générer avec Studio</Link></div> : undefined}
          />
        ) : null)}
      >
        {(d) => (
          <div className={cn(selected.size > 0 && "max-md:pb-28")}>
            {d.items.length === 0 ? (
              <EmptyState icon={<Search />} title="Aucun article ne correspond" description={query.q ? `Rien pour « ${query.q} » avec ces filtres.` : "Essayez un autre filtre ou un autre statut."} action={<Button variant="secondary" onClick={() => { setSearch(""); setParams(new URLSearchParams(), { replace: true }); }}>Effacer la recherche et les filtres</Button>} />
            ) : (
              <>
                {canWrite ? (
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
                    <label className="inline-flex cursor-pointer items-center gap-2"><Checkbox aria-label="Tout sélectionner" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(allIds) : new Set())} />Tout sélectionner sur la page</label>
                    <span className="max-md:hidden"><Kbd>/</Kbd> chercher · <Kbd>n</Kbd> nouvel article · <Kbd>Échap</Kbd> vider la sélection</span>
                  </div>
                ) : null}
                {view === "grid" ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
                    {d.items.map((it) => <ItemCard key={it.id} rules={rules} {...lineProps(it)} />)}
                  </div>
                ) : (
                  <>
                    <ul aria-label="Articles" className="card divide-y divide-border p-0 md:hidden">
                      {d.items.map((it) => <ItemMobileRow key={it.id} {...lineProps(it)} />)}
                    </ul>
                    <TableWrap className="max-md:hidden">
                      <Table>
                        <thead>
                          <tr>
                            {canWrite ? <Th className="w-10"><span className="sr-only">Sélection</span></Th> : null}
                            <Th>Article</Th>
                            <Th>Statut</Th>
                            <Th numeric>Achat</Th>
                            <Th numeric>Prix affiché</Th>
                            <Th numeric>Plancher</Th>
                            <Th numeric>Marge projetée</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.items.length === 0 ? <TableEmpty colSpan={7}>Aucun article.</TableEmpty> : d.items.map((it) => <ItemRow key={it.id} rules={rules} {...lineProps(it)} onOpen={() => navigate(`/app/items/${it.id}`)} />)}
                        </tbody>
                      </Table>
                    </TableWrap>
                  </>
                )}
                <Pagination className="mt-3" page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} onPageChange={(p) => set("page", String(p))} />
              </>
            )}
          </div>
        )}
      </QueryBoundary>
      {bulk.isError ? <p className="sr-only" role="alert">{errorMessage(bulk.error)}</p> : null}
    </>
  );
}
