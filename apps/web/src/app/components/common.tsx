import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { CONNECTOR_STATUS_LABELS, ITEM_STATUS_LABELS, JOB_STATUS_LABELS, MESSAGE_STATUS_LABELS, ORDER_STATUS_LABELS, type ConnectorStatus, type ItemStatus, type JobStatus, type MessageStatus, type OrderStatus, type Photo } from "@selio/contracts";
import { centsToDecimalString, parseEuroInput, type PeriodPreset } from "@selio/domain";
import { ErrorState, Input, LoadingState, Segmented, SkeletonRows, StatusBadge, cn, type StatusTone } from "@selio/ui";
import { errorMessage } from "../../lib/errors";

export function QueryBoundary<T>({ query, children, skeleton = "rows", empty }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; skeleton?: "rows" | "spinner"; empty?: (data: T) => ReactNode }) {
  if (query.isPending) return skeleton === "rows" ? <SkeletonRows /> : <LoadingState />;
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (empty) {
    const e = empty(query.data);
    if (e) return <>{e}</>;
  }
  return <>{children(query.data)}</>;
}

const ITEM_TONE: Record<ItemStatus, StatusTone> = { in_stock: "neutral", listed: "accent", reserved: "warning", sold: "ink", archived: "muted" };
export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <StatusBadge tone={ITEM_TONE[status]}>{ITEM_STATUS_LABELS[status]}</StatusBadge>;
}

const ORDER_TONE: Record<OrderStatus, StatusTone> = { pending: "warning", paid: "accent", shipped: "accent", delivered: "success", completed: "ink", cancelled: "muted", refunded: "danger" };
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <StatusBadge tone={ORDER_TONE[status]}>{ORDER_STATUS_LABELS[status]}</StatusBadge>;
}

const MSG_TONE: Record<MessageStatus, StatusTone> = { received: "neutral", draft: "muted", pending: "warning", sent: "success", failed: "danger" };
export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <StatusBadge tone={MSG_TONE[status]}>{MESSAGE_STATUS_LABELS[status]}</StatusBadge>;
}

const CONN_TONE: Record<ConnectorStatus, StatusTone> = { not_configured: "muted", ready: "warning", connected: "success", degraded: "warning", expired: "danger", disconnected: "muted", unsupported: "muted" };
export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  return <StatusBadge tone={CONN_TONE[status]}>{CONNECTOR_STATUS_LABELS[status]}</StatusBadge>;
}

const JOB_TONE: Record<JobStatus, StatusTone> = { queued: "neutral", running: "accent", succeeded: "success", failed: "danger", cancelled: "muted", skipped: "muted", awaiting_approval: "warning" };
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <StatusBadge tone={JOB_TONE[status]}>{JOB_STATUS_LABELS[status]}</StatusBadge>;
}

export const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: "7d", label: "7 j" },
  { value: "30d", label: "30 j" },
  { value: "90d", label: "90 j" },
  { value: "12m", label: "12 mois" },
  { value: "ytd", label: "Année" },
  { value: "all", label: "Tout" },
];

export function PeriodPicker({ value, onChange }: { value: PeriodPreset; onChange: (p: PeriodPreset) => void }) {
  return <Segmented ariaLabel="Période" value={value} onChange={onChange} items={PERIODS} size="sm" />;
}

/** Champ montant : saisie « 12,50 », valeur en centimes. */
export function MoneyInput({ value, onChange, id, invalid, placeholder = "0,00", allowEmpty = true, ...rest }: { value: number | null; onChange: (cents: number | null) => void; id?: string; invalid?: boolean; placeholder?: string; allowEmpty?: boolean; "aria-describedby"?: string; disabled?: boolean }) {
  const [text, setText] = useState(value === null ? "" : centsToDecimalString(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value === null ? "" : centsToDecimalString(value);
  return (
    <Input
      id={id}
      inputMode="decimal"
      invalid={invalid}
      placeholder={placeholder}
      value={shown}
      onFocus={() => { setText(value === null ? "" : centsToDecimalString(value)); setFocused(true); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseEuroInput(e.target.value);
        if (e.target.value.trim() === "" && allowEmpty) onChange(null);
        else if (parsed !== null) onChange(parsed);
      }}
      suffix={<span className="text-sm">€</span>}
      {...rest}
    />
  );
}

export function ItemThumb({ photos, title, size = 40, className }: { photos: Photo[]; title: string; size?: number; className?: string }) {
  const p = photos[0];
  return (
    <span className={cn("block shrink-0 overflow-hidden rounded-md bg-surface-muted", className)} style={{ width: size, height: size }}>
      {p ? <img src={p.url} alt={p.alt || title} width={size} height={size} loading="lazy" className="size-full object-cover" /> : null}
    </span>
  );
}

export function Delta({ current, previous, format }: { current: number; previous: number; format: (v: number) => string }) {
  if (previous === 0) return <span className="text-text-muted">{format(current)} · pas de base de comparaison</span>;
  const r = (current - previous) / Math.abs(previous);
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return <span className={r > 0 ? "text-success" : r < 0 ? "text-danger" : "text-text-muted"}>{sign}{Math.abs(r * 100).toFixed(1).replace(".", ",")} % vs période précédente</span>;
}
