import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { CalendarClock, Check, ImageOff, Pencil, X } from "lucide-react";
import { ITEM_STATUS_LABELS, type InventoryItem, type ItemStatus, type MarginRules } from "@selio/contracts";
import { ITEM_TRANSITIONS, daysInStock, daysOnline, parseEuroInput, projectedMargin } from "@selio/domain";
import { Checkbox, IconButton, Money, Td, Tr, cn, formatCents, formatPercent } from "@selio/ui";
import { ItemThumb } from "./common";
import { Finance } from "./finance";

/**
 * Éléments de « Articles et stock » : édition rapide du prix et du statut sans quitter la liste, carte de la
 * grille, ligne du tableau (ordinateur) et ligne compacte (téléphone).
 */

const STATUS_TONE: Record<ItemStatus, string> = {
  in_stock: "bg-surface-muted text-text",
  listed: "bg-accent-soft text-accent",
  reserved: "bg-warning/15 text-warning",
  sold: "bg-success/15 text-success",
  archived: "bg-surface-muted text-text-muted",
};

/** Statut modifiable sur place : liste des transitions permises (même règle que le serveur). */
export function QuickStatus({ item, canWrite, onChange, busy }: { item: InventoryItem; canWrite: boolean; onChange: (s: ItemStatus) => void; busy?: boolean }) {
  const cls = cn("inline-flex h-6 items-center rounded-full px-2 text-xs font-medium max-md:h-8", STATUS_TONE[item.status]);
  if (!canWrite) return <span className={cls}>{ITEM_STATUS_LABELS[item.status]}</span>;
  const options = [item.status, ...ITEM_TRANSITIONS[item.status]];
  return (
    <select
      aria-label={`Statut de ${item.title}`}
      value={item.status}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as ItemStatus)}
      className={cn(cls, "cursor-pointer appearance-none border-0 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60")}
    >
      {options.map((s) => <option key={s} value={s}>{ITEM_STATUS_LABELS[s]}</option>)}
    </select>
  );
}

/** Prix affiché modifiable sur place : Entrée enregistre, Échap annule. */
export function QuickPrice({ item, canWrite, onSave, busy, className }: { item: InventoryItem; canWrite: boolean; onSave: (cents: number | null) => void; busy?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const shown = item.listedPriceCents === null ? <span className="text-sm font-normal text-text-muted">Sans prix</span> : formatCents(item.listedPriceCents);
  if (!canWrite) return <span className={cn("num font-semibold", className)}>{shown}</span>;
  if (!editing) {
    return (
      <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); setText(item.listedPriceCents === null ? "" : (item.listedPriceCents / 100).toFixed(2).replace(".", ",")); setEditing(true); }} className={cn("tap-target group/price num inline-flex items-center gap-1 rounded-md px-1 -mx-1 font-semibold hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none", className)} aria-label={`Modifier le prix de ${item.title}`} title="Modifier le prix">
        {shown}<Pencil className="size-3 text-text-muted opacity-60 group-hover/price:opacity-100" aria-hidden />
      </button>
    );
  }
  const parsed = text.trim() === "" ? null : parseEuroInput(text);
  const invalid = text.trim() !== "" && parsed === null;
  const commit = () => { if (invalid) return; setEditing(false); if (parsed !== item.listedPriceCents) onSave(parsed); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
  };
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="relative">
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} inputMode="decimal" aria-label={`Nouveau prix de ${item.title}`} aria-invalid={invalid || undefined} className={cn("num h-8 w-24 rounded-md border bg-surface pr-6 pl-2 text-sm text-text outline-none max-md:h-11 max-md:text-md focus-visible:ring-2 focus-visible:ring-accent", invalid ? "border-danger" : "border-border-strong")} />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-text-muted">€</span>
      </span>
      <IconButton size="sm" label="Enregistrer le prix" onClick={commit} disabled={invalid}><Check /></IconButton>
      <IconButton size="sm" label="Annuler" onClick={() => setEditing(false)}><X /></IconButton>
    </span>
  );
}

interface LineProps {
  item: InventoryItem;
  rules: MarginRules;
  selected: boolean;
  canWrite: boolean;
  busy: boolean;
  onSelect: (v: boolean) => void;
  onStatus: (s: ItemStatus) => void;
  onPrice: (cents: number | null) => void;
}

export function ItemCard({ item, rules, selected, canWrite, busy, onSelect, onStatus, onPrice }: LineProps) {
  const m = projectedMargin(item, rules);
  const now = new Date();
  const online = daysOnline(item, now);
  return (
    <article aria-label={item.title} className={cn("card group relative flex flex-col overflow-hidden transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md", selected && "border-accent ring-1 ring-accent")}>
      <Link to={`/app/items/${item.id}`} className="relative block aspect-[4/5] bg-surface-muted" tabIndex={-1} aria-hidden>
        {item.photos[0] ? <img src={item.photos[0].url} alt="" loading="lazy" className="size-full object-cover" /> : <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-text-muted"><ImageOff className="size-6" aria-hidden />Sans photo</span>}
        {online !== null && (item.status === "listed" || item.status === "reserved") ? <span className={cn("absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 text-[11px] font-medium shadow-sm", online >= 7 ? "text-accent" : "text-text-muted")}><CalendarClock className="size-3" aria-hidden />{online} j en ligne</span> : null}
      </Link>
      {canWrite ? <span className={cn("absolute top-2 left-2 rounded-md bg-surface/90 p-1 transition-opacity", selected ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100")}><Checkbox aria-label={`Sélectionner ${item.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></span> : null}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link to={`/app/items/${item.id}`} className="tap-target line-clamp-2 text-sm leading-snug font-medium text-text hover:text-accent">{item.title}</Link>
        <p className="truncate text-xs text-text-muted">{[item.brand, item.size, item.sku].filter(Boolean).join(" · ") || "—"}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2">
          <QuickPrice item={item} canWrite={canWrite} onSave={onPrice} busy={busy} className="text-base" />
          <QuickStatus item={item} canWrite={canWrite} onChange={onStatus} busy={busy} />
        </div>
        <p className="num flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-text-muted">
          <span>{daysInStock(item, now)} j en stock</span>
          <Finance fallback={null}>{m ? <span className={cn("font-medium", m.marginCents >= 0 ? "text-success" : "text-danger")}>{m.marginCents >= 0 ? "+" : ""}{formatCents(m.marginCents)} · {formatPercent(m.marginRate)}</span> : null}</Finance>
        </p>
      </div>
    </article>
  );
}

/** Ligne du tableau (ordinateur). */
export function ItemRow({ item, rules, selected, canWrite, busy, onSelect, onStatus, onPrice, onOpen }: LineProps & { onOpen: () => void }) {
  const m = projectedMargin(item, rules);
  return (
    <Tr interactive selected={selected} tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(); }}>
      {canWrite ? <Td onClick={(e) => e.stopPropagation()}><Checkbox aria-label={`Sélectionner ${item.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></Td> : null}
      <Td>
        <span className="flex items-center gap-3">
          <ItemThumb photos={item.photos} title={item.title} size={44} />
          <span className="min-w-0">
            <span className="block max-w-[28ch] truncate font-medium text-text">{item.title}</span>
            <span className="block truncate text-xs text-text-muted">{[item.brand, item.size, item.sku].filter(Boolean).join(" · ")}</span>
          </span>
        </span>
      </Td>
      <Td onClick={(e) => e.stopPropagation()}><QuickStatus item={item} canWrite={canWrite} onChange={onStatus} busy={busy} /></Td>
      <Td numeric><Finance><Money cents={item.purchasePriceCents + item.purchaseFeesCents} /></Finance></Td>
      <Td numeric onClick={(e) => e.stopPropagation()}><QuickPrice item={item} canWrite={canWrite} onSave={onPrice} busy={busy} /></Td>
      <Td numeric>{item.floorPriceCents === null ? <span className="text-text-muted">—</span> : <Money cents={item.floorPriceCents} />}</Td>
      <Td numeric><Finance>{m ? <span className="inline-flex flex-col items-end"><Money cents={m.marginCents} signed /><span className="text-xs text-text-muted">{formatPercent(m.marginRate)}</span></span> : <span className="text-text-muted">—</span>}</Finance></Td>
    </Tr>
  );
}

/** Ligne compacte (téléphone) : vignette, titre, prix et statut modifiables, sélection. */
export function ItemMobileRow({ item, selected, canWrite, busy, onSelect, onStatus, onPrice }: Omit<LineProps, "rules">) {
  return (
    <li className={cn("flex items-start gap-3 px-3 py-3", selected && "bg-accent-soft/40")}>
      {canWrite ? <span className="pt-3"><Checkbox aria-label={`Sélectionner ${item.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></span> : null}
      <Link to={`/app/items/${item.id}`} tabIndex={-1} aria-hidden><ItemThumb photos={item.photos} title={item.title} size={56} className="rounded-lg" /></Link>
      <div className="min-w-0 flex-1">
        <Link to={`/app/items/${item.id}`} className="line-clamp-2 text-sm leading-snug font-medium text-text">{item.title}</Link>
        <p className="truncate text-xs text-text-muted">{[item.brand, item.size].filter(Boolean).join(" · ") || "—"}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <QuickPrice item={item} canWrite={canWrite} onSave={onPrice} busy={busy} className="text-sm" />
          <QuickStatus item={item} canWrite={canWrite} onChange={onStatus} busy={busy} />
        </div>
      </div>
    </li>
  );
}
