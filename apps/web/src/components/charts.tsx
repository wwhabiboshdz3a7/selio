import { useEffect, useId, useRef, useState } from "react";
import { cn, formatCents } from "@selio/ui";

/**
 * Graphiques SVG maison conformes à la charte v3 : améthyste d'abord
 * (--accent-vivid), or en second, séries secondaires en encre ou gris,
 * grille horizontale seule. Les autres tons ne servent qu'aux répartitions.
 */
export interface SeriesDatum {
  label: string;
  primary: number;
  secondary?: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

export function BarChart({ data, height = 220, formatValue = (v) => formatCents(v, { compact: true }), primaryLabel = "CA", secondaryLabel = "Marge", className }: { data: SeriesDatum[]; height?: number; formatValue?: (v: number) => string; primaryLabel?: string; secondaryLabel?: string; className?: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 640;
      setWidth(Math.max(300, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { top: 12, right: 8, bottom: 28, left: 52 };
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.primary, d.secondary ?? 0)), 1));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = Math.max(1, data.length);
  const slot = innerW / n;
  const barW = Math.min(28, slot * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(n / Math.max(3, Math.floor(width / 80)));
  return (
    <figure ref={ref} className={cn("w-full", className)} aria-describedby={`${id}-desc`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>{primaryLabel} et {secondaryLabel} par période</title>
        {ticks.map((t) => {
          const y = pad.top + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)" className="num">{formatValue(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const hP = (d.primary / max) * innerH;
          const hS = ((d.secondary ?? 0) / max) * innerH;
          const active = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label} : ${primaryLabel} ${formatValue(d.primary)}${d.secondary !== undefined ? `, ${secondaryLabel} ${formatValue(d.secondary)}` : ""}`}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
              <rect x={x} y={pad.top + innerH - hP} width={barW} height={hP} rx={4} fill="var(--accent-vivid)" opacity={hover === null || active ? 0.35 : 0.18} />
              {d.secondary !== undefined ? <rect x={x} y={pad.top + innerH - hS} width={barW} height={hS} rx={4} fill="var(--accent-vivid)" opacity={hover === null || active ? 1 : 0.45} /> : null}
              {i % labelEvery === 0 ? <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{d.label}</text> : null}
            </g>
          );
        })}
      </svg>
      <figcaption id={`${id}-desc`} className="mt-2 flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent-vivid opacity-35" aria-hidden /> {primaryLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent-vivid" aria-hidden /> {secondaryLabel}</span>
        {hover !== null && data[hover] ? (
          <span className="num ml-auto text-text">
            {data[hover]!.label} · {formatValue(data[hover]!.primary)}{data[hover]!.secondary !== undefined ? ` · ${formatValue(data[hover]!.secondary!)}` : ""}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function HorizontalBars({ rows, formatValue = (v) => formatCents(v, { compact: true }), className, tone = "var(--accent-vivid)" }: { rows: { label: string; value: number; hint?: string }[]; formatValue?: (v: number) => string; className?: string; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-text">{r.label}</span>
              {r.hint ? <span className="num shrink-0 text-xs text-text-muted">{r.hint}</span> : null}
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: tone }} />
            </div>
          </div>
          <span className="num w-20 text-right font-medium text-text">{formatValue(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ values, className, tone = "var(--accent-vivid)" }: { values: number[]; className?: string; tone?: string }) {
  const id = useId();
  const w = 120, h = 32;
  const max = Math.max(1, ...values);
  const coords = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - (v / max) * (h - 4) - 2] as const);
  const pts = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = coords.length ? `M0,${h} L${coords.map(([x, y]) => `${x},${y}`).join(" L")} L${w},${h} Z` : "";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className ?? "h-8 w-30"} aria-hidden>
      <defs>
        <linearGradient id={`${id}-s`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity={0.18} />
          <stop offset="100%" stopColor={tone} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill={`url(#${id}-s)`} /> : null}
      <polyline points={pts} fill="none" stroke={tone} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Palette catégorielle : améthyste, or, ardoise, puis tons secondaires (répartitions uniquement). */
export const CHART_TONES = ["var(--tone-braise)", "var(--tone-amber)", "var(--tone-slate)", "var(--tone-indigo)", "var(--tone-rose)", "var(--tone-teal)", "var(--tone-sky)", "var(--violet-300)"];

function useWidth(initial = 480) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(220, Math.round(entries[0]?.contentRect.width ?? initial))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return { ref, width };
}

/** Courbe avec aire (cumuls, taux, évolutions). */
export function AreaChart({ data, height = 200, formatValue = (v) => formatCents(v, { compact: true }), tone = "var(--accent-vivid)", label = "Valeur", className }: { data: { label: string; value: number }[]; height?: number; formatValue?: (v: number) => string; tone?: string; label?: string; className?: string }) {
  const id = useId();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 10, bottom: 26, left: 52 };
  const values = data.map((d) => d.value);
  const min = Math.min(0, ...values);
  const max = niceMax(Math.max(1, ...values));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min || 1)) * innerH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = data.length ? `${line} L${x(data.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z` : "";
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(width / 90)));
  const ticks = [0, 0.5, 1].map((t) => min + t * (max - min));
  return (
    <div ref={ref} className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${label} : ${data.length ? formatValue(data[data.length - 1]!.value) : "aucune donnée"}`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity={0.2} />
            <stop offset="100%" stopColor={tone} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)" className="num">{formatValue(t)}</text>
          </g>
        ))}
        {area ? <path d={area} fill={`url(#${id}-g)`} /> : null}
        {line ? <path d={line} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {data.map((d, i) => (
          <g key={i}>
            <rect x={x(i) - innerW / Math.max(1, data.length) / 2} y={pad.top} width={innerW / Math.max(1, data.length)} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            {hover === i ? <><line x1={x(i)} x2={x(i)} y1={pad.top} y2={pad.top + innerH} stroke="var(--border-strong)" strokeDasharray="3 3" /><circle cx={x(i)} cy={y(d.value)} r={4.5} fill="var(--surface)" stroke={tone} strokeWidth={2.5} /></> : null}
            {i % labelEvery === 0 ? <text x={x(i)} y={height - 7} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{d.label}</text> : null}
          </g>
        ))}
      </svg>
      <p className="num mt-1 h-4 text-xs text-text-muted">{hover !== null && data[hover] ? `${data[hover]!.label} · ${formatValue(data[hover]!.value)}` : ""}</p>
    </div>
  );
}

/** Anneau de répartition (parts d'un total). */
export function DonutChart({ rows, size = 168, formatValue = (v) => formatCents(v, { compact: true }), centerLabel, className }: { rows: { label: string; value: number }[]; size?: number; formatValue?: (v: number) => string; centerLabel?: string; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const active = hover !== null ? rows[hover] : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Répartition : ${rows.map((x) => `${x.label} ${formatValue(x.value)}`).join(", ")}`} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-muted)" strokeWidth={18} />
        {total > 0 ? rows.map((row, i) => {
          const len = (Math.max(0, row.value) / total) * c;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CHART_TONES[i % CHART_TONES.length]} strokeWidth={hover === i ? 22 : 18} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: "stroke-width 120ms" }} />;
          offset += len;
          return el;
        }) : null}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={17} fontWeight={600} fill="var(--text)" className="num">{active ? formatValue(active.value) : formatValue(total)}</text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{active ? `${Math.round((active.value / (total || 1)) * 100)} % · ${active.label}`.slice(0, 26) : centerLabel ?? "Total"}</text>
      </svg>
      <ul className="flex min-w-[140px] flex-1 flex-col gap-1.5 text-sm">
        {rows.slice(0, 8).map((row, i) => (
          <li key={row.label} className="flex items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CHART_TONES[i % CHART_TONES.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-text">{row.label}</span>
            <span className="num text-text-muted">{total ? Math.round((row.value / total) * 100) : 0} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Jauge demi-cercle (objectif, taux). */
export function Gauge({ value, max, label, sublabel, tone = "var(--accent-vivid)", size = 200 }: { value: number; max: number; label: string; sublabel?: string; tone?: string; size?: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = size / 2 - 14;
  const c = Math.PI * r;
  const h = size / 2 + 8;
  return (
    <figure className="flex flex-col items-center">
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={`${label} : ${Math.round(ratio * 100)} %`}>
        <path d={`M14 ${size / 2} A ${r} ${r} 0 0 1 ${size - 14} ${size / 2}`} fill="none" stroke="var(--surface-muted)" strokeWidth={12} strokeLinecap="round" />
        <path d={`M14 ${size / 2} A ${r} ${r} 0 0 1 ${size - 14} ${size / 2}`} fill="none" stroke={tone} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${ratio * c} ${c}`} />
        <text x={size / 2} y={size / 2 - 10} textAnchor="middle" fontSize={26} fontWeight={600} fill="var(--text)" className="num">{Math.round(ratio * 100)} %</text>
      </svg>
      <figcaption className="-mt-1 text-center">
        <span className="block text-sm font-medium text-text">{label}</span>
        {sublabel ? <span className="num block text-xs text-text-muted">{sublabel}</span> : null}
      </figcaption>
    </figure>
  );
}

/**
 * Échelle des notes sur 100, cohérente avec la charte : or = excellent,
 * améthyste = bon, lavande = moyen, orchidée = faible.
 * « deal » : bonnes affaires (75 = à valider, 85 = achat auto) ;
 * « listing » : annonces du dressing (80 = excellente, 60 = bonne, 40 = à améliorer).
 */
export type ScoreScale = "deal" | "listing";
const SCORE_STEPS: Record<ScoreScale, [number, number, number]> = { deal: [85, 75, 60], listing: [80, 60, 40] };

/** Lavande adaptée au mode : améthyste diluée dans la surface (claire en mode clair, sourde en mode sombre). */
const SCORE_FAIR = "color-mix(in srgb, var(--accent-vivid) 42%, var(--surface-muted))";

function scoreLevel(score: number, scale: ScoreScale): 0 | 1 | 2 | 3 {
  const [top, good, fair] = SCORE_STEPS[scale];
  return score >= top ? 3 : score >= good ? 2 : score >= fair ? 1 : 0;
}

/** Couleur graphique d'une note (anneaux, barres, pastilles). */
export function scoreTone(score: number, scale: ScoreScale = "deal"): string {
  return ["var(--tone-rose)", SCORE_FAIR, "var(--accent-vivid)", "var(--gold)"][scoreLevel(score, scale)]!;
}

/** Couleur de texte lisible (AA) associée à une note. */
export function scoreTextTone(score: number, scale: ScoreScale = "deal"): string {
  return ["var(--danger)", "var(--text-muted)", "var(--accent)", "var(--gold-text)"][scoreLevel(score, scale)]!;
}

/** Note circulaire sur 100 (bonnes affaires, annonces). */
export function ScoreRing({ score, size = 48, stroke = 5, label, scale = "deal", className }: { score: number; size?: number; stroke?: number; label?: string; scale?: ScoreScale; className?: string }) {
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tone = scoreTone(s, scale);
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Note"} ${s} sur 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="var(--surface)" stroke="var(--surface-muted)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(s / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="num absolute font-semibold text-text" style={{ fontSize: Math.round(size * 0.32) }}>{s}</span>
    </span>
  );
}

/** Barres verticales simples (une série catégorielle). */
export function ColumnChart({ rows, height = 180, formatValue = (v) => String(v), tone = "var(--accent-vivid)", highlightMax = true, className }: { rows: { label: string; value: number }[]; height?: number; formatValue?: (v: number) => string; tone?: string; highlightMax?: boolean; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const best = rows.reduce((b, r, i) => (r.value > (rows[b]?.value ?? -1) ? i : b), 0);
  return (
    <div className={cn("flex items-end gap-2", className)} style={{ height }} role="img" aria-label={rows.map((r) => `${r.label} ${formatValue(r.value)}`).join(", ")}>
      {rows.map((r, i) => (
        <div key={r.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="num text-[11px] text-text-muted">{r.value ? formatValue(r.value) : ""}</span>
          <div className="w-full max-w-10 rounded-t-md" style={{ height: `${Math.max(3, (r.value / max) * (height - 44))}px`, background: tone, opacity: highlightMax && i !== best ? 0.35 : 1 }} />
          <span className="w-full truncate text-center text-[11px] text-text-muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Barre empilée horizontale (répartition par tranches). */
export function StackedBar({ rows, className }: { rows: { label: string; value: number; tone?: string }[]; className?: string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className={className}>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted">
        {rows.map((r, i) => (total ? <div key={r.label} style={{ width: `${(r.value / total) * 100}%`, background: r.tone ?? CHART_TONES[i % CHART_TONES.length] }} title={`${r.label} : ${r.value}`} /> : null))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {rows.map((r, i) => <li key={r.label} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: r.tone ?? CHART_TONES[i % CHART_TONES.length] }} aria-hidden />{r.label} <span className="num text-text">{r.value}</span></li>)}
      </ul>
    </div>
  );
}
