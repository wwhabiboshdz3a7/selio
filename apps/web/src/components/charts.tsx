import { useEffect, useId, useRef, useState } from "react";
import { cn, formatCents } from "@selio/ui";

/**
 * Graphiques SVG maison conformes à la charte : une seule couleur vive
 * (--accent-vivid), séries secondaires en gris, grille horizontale seule.
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
              <rect x={x} y={pad.top + innerH - hP} width={barW} height={hP} rx={4} fill="var(--accent-vivid)" opacity={hover === null || active ? 1 : 0.5} />
              {d.secondary !== undefined ? <rect x={x} y={pad.top + innerH - hS} width={barW} height={hS} rx={4} fill="var(--gray-900)" opacity={hover === null || active ? 0.85 : 0.4} /> : null}
              {i % labelEvery === 0 ? <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{d.label}</text> : null}
            </g>
          );
        })}
      </svg>
      <figcaption id={`${id}-desc`} className="mt-2 flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent-vivid" aria-hidden /> {primaryLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-gray-900" aria-hidden /> {secondaryLabel}</span>
        {hover !== null && data[hover] ? (
          <span className="num ml-auto text-text">
            {data[hover]!.label} · {formatValue(data[hover]!.primary)}{data[hover]!.secondary !== undefined ? ` · ${formatValue(data[hover]!.secondary!)}` : ""}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function HorizontalBars({ rows, formatValue = (v) => formatCents(v, { compact: true }), className }: { rows: { label: string; value: number; hint?: string }[]; formatValue?: (v: number) => string; className?: string }) {
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
              <div className="h-full rounded-full bg-accent-vivid" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
            </div>
          </div>
          <span className="num w-20 text-right font-medium text-text">{formatValue(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 120, h = 32;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-30", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--accent-vivid)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
