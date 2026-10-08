const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurNoDecimals = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("fr-FR");
const pct = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

/** Montant en centimes → « 1 286,00 € ». Signe « − » typographique pour les négatifs. */
export function formatCents(cents: number, opts: { compact?: boolean } = {}): string {
  const s = (opts.compact ? eurNoDecimals : eur).format(cents / 100);
  return s.replace("-", "−");
}

export function formatNumber(n: number): string {
  return num.format(n).replace("-", "−");
}

/** Taux 0.42 → « 42 % ». */
export function formatPercent(ratio: number): string {
  return pct.format(ratio).replace("-", "−");
}

const dateShort = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateLong = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string | Date, style: "short" | "long" = "short"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return (style === "long" ? dateLong : dateShort).format(d);
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return dateTime.format(d);
}

export function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return timeOnly.format(d);
}

/** « il y a 3 min », « hier », « il y a 4 j ». */
export function formatRelative(iso: string | Date, now: Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = now.getTime() - d.getTime();
  if (Number.isNaN(diff)) return "—";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  return dateShort.format(d);
}
