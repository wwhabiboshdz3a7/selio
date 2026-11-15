import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bell, LineChart } from "lucide-react";
import { TRACK_ALERT_RULE_LABELS, TRACK_DEMO_NOTICE, TRACK_SOURCE_LABELS, TRACK_TRENDS_DEFAULT_DAYS, type TrackAlertRules, type TrackFilter, type TrackFilterAlerts } from "@selio/contracts";
import { can } from "@selio/domain";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Segmented, StatStrip, StatusBadge, Tag, Toggle, formatCents, formatDateTime, formatNumber, formatPercent } from "@selio/ui";
import { AreaChart, ColumnChart, HorizontalBars } from "../../../components/charts";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { TrackTrendsView, TrackUsageView } from "../../../lib/data/types";
import { criteriaTags, trendWindows } from "../../../lib/track";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { Change, TrackGate, TrackNotices } from "./shared";

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/**
 * Selio Track · tendances d'un filtre : prix médian, annonces actives, nouvelles et disparues (« vendues ou
 * retirées », une estimation), parts de marques. Sur 7, 30 ou 90 jours, dans la limite de l'historique.
 */
export default function TrackFilterDetail() {
  return <TrackGate>{(u) => <Detail usage={u} />}</TrackGate>;
}

function Detail({ usage }: { usage: TrackUsageView }) {
  const { id = "" } = useParams();
  const client = useClient();
  const windows = trendWindows(usage.historyMonths);
  const [days, setDays] = useState(String(windows.includes(TRACK_TRENDS_DEFAULT_DAYS) ? TRACK_TRENDS_DEFAULT_DAYS : windows[windows.length - 1] ?? TRACK_TRENDS_DEFAULT_DAYS));
  const filters = useQuery({ queryKey: ["track-filters"], queryFn: () => client.trackFilters() });
  const trends = useQuery({ queryKey: ["track-trends", id, Number(days)], queryFn: () => client.trackTrends(id, Number(days)), enabled: id !== "" });
  const filter = filters.data?.find((f) => f.id === id) ?? null;
  return (
    <>
      <Link to="/track/filtres" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden />Filtres suivis</Link>
      <QueryBoundary query={filters} skeleton="spinner">
        {() => (!filter ? <ErrorState title="Filtre introuvable" description="Ce filtre a été retiré ou n'existe pas." /> : (
          <>
            <PageHeader
              eyebrow="Selio Track · tendances"
              title={filter.name}
              description={<FilterSummary filter={filter} />}
              actions={windows.length > 1 ? <Segmented ariaLabel="Période" size="sm" value={days} onChange={setDays} items={windows.map((d) => ({ value: String(d), label: `${d} jours` }))} /> : undefined}
            />
            {!filter.enabled ? <p className="mb-4 text-sm text-text-muted">Ce filtre est en pause : il n'est plus relu et ses alertes ne sont pas évaluées. <Link to="/track/filtres" className="font-medium text-accent hover:underline">Le reprendre</Link></p> : null}
            <QueryBoundary query={trends}>{(t) => <Trends trends={t} filter={filter} />}</QueryBoundary>
            <FilterAlerts filter={filter} />
          </>
        ))}
      </QueryBoundary>
    </>
  );
}

function FilterSummary({ filter }: { filter: TrackFilter }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {criteriaTags(filter.criteria).map((t) => <Tag key={t}>{t}</Tag>)}
      <Tag>Prix max {formatCents(filter.criteria.maxPriceCents)}</Tag>
    </span>
  );
}

function Trends({ trends: t, filter }: { trends: TrackTrendsView; filter: TrackFilter }) {
  if (t.points.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState icon={<LineChart />} title="Pas encore de lecture" description={`Ce filtre est lu toutes les 2 h : les premières statistiques arrivent après la prochaine lecture${filter.nextReadAt ? ` (vers ${formatDateTime(filter.nextReadAt)})` : ""}.`} />
        <TrackNotices notices={t.notices} />
      </div>
    );
  }
  const last = t.points[t.points.length - 1]!;
  const priced = t.points.filter((p) => p.medianPriceCents !== null);
  const newTotal = t.points.reduce((n, p) => n + p.newCount, 0);
  return (
    <div className="flex flex-col gap-6">
      <TrackNotices notices={t.notices} />
      <StatStrip
        className="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Prix médian", value: last.medianPriceCents !== null ? formatCents(last.medianPriceCents) : "—", sub: <>Sur {t.days} jours : <Change value={t.medianPriceChange} /></> },
          { label: "Annonces actives", value: formatNumber(last.listedCount), sub: "À la dernière lecture du jour" },
          { label: "Nouvelles annonces", value: formatNumber(newTotal), sub: `Sur ${t.days} jours` },
          { label: "Disparues (estimation)", value: formatNumber(t.goneTotal), sub: "Vendues ou retirées" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-md font-semibold">Prix médian par jour</h2>
          <p className="mb-3 text-sm text-text-muted">Médiane des prix affichés des annonces en ligne.</p>
          {priced.length ? <AreaChart data={priced.map((p) => ({ label: dayLabel(p.day), value: p.medianPriceCents! }))} label="Prix médian" /> : <p className="text-sm text-text-muted">Aucun prix lu sur la période.</p>}
        </Card>
        <Card>
          <h2 className="text-md font-semibold">Annonces actives</h2>
          <p className="mb-3 text-sm text-text-muted">Une page de résultats au plus par lecture.</p>
          <AreaChart data={t.points.map((p) => ({ label: dayLabel(p.day), value: p.listedCount }))} formatValue={(v) => formatNumber(Math.round(v))} label="Annonces actives" />
        </Card>
        <Card>
          <h2 className="text-md font-semibold">Nouvelles et disparues, sur les 14 derniers jours</h2>
          <p className="mb-3 text-sm text-text-muted">Disparue = plus en ligne à la lecture suivante : vendue OU retirée (estimation).</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-medium">Nouvelles</h3><ColumnChart rows={t.points.slice(-14).map((p) => ({ label: dayLabel(p.day).slice(0, 2), value: p.newCount }))} height={150} /></div>
            <div><h3 className="mb-2 text-sm font-medium">Disparues (estimation)</h3><ColumnChart rows={t.points.slice(-14).map((p) => ({ label: dayLabel(p.day).slice(0, 2), value: p.goneCount }))} height={150} /></div>
          </div>
        </Card>
        <Card>
          <h2 className="text-md font-semibold">Parts de marques</h2>
          <p className="mb-3 text-sm text-text-muted">Annonces en ligne à la dernière lecture, par marque.</p>
          {t.brandShares?.length ? <HorizontalBars rows={t.brandShares.map((b) => ({ label: b.brand, value: b.share, hint: `${b.count} annonce(s)` }))} formatValue={(v) => formatPercent(v)} /> : <p className="text-sm text-text-muted">Parts de marques indisponibles pour cette lecture.</p>}
        </Card>
      </div>
      <p className="text-xs text-text-muted">
        {t.snapshots} lecture(s) sur la période · source : {t.source ? TRACK_SOURCE_LABELS[t.source] : "aucune lecture"}{filter.nextReadAt ? ` · prochaine lecture vers ${formatDateTime(filter.nextReadAt)}` : ""} · empreinte partagée {filter.fingerprint.slice(0, 10)}…
      </p>
    </div>
  );
}

const clampInt = (raw: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(raw.replace(",", ".")));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * Alertes de tendance du filtre : prix médian qui bouge de ± X %, nouvelles annonces au-dessus d'un seuil,
 * délai de vente qui baisse (estimation). Évaluées après chaque lecture, une par règle et par 24 h au plus,
 * envoyées sur les appareils abonnés aux notifications ; coupées par défaut, désactivables d'un geste.
 */
function FilterAlerts({ filter }: { filter: TrackFilter }) {
  const client = useClient();
  const session = useRequiredSession();
  const canWrite = can(session.role, "radar.write");
  const alerts = useQuery({ queryKey: ["track-alerts", filter.id], queryFn: () => client.trackFilterAlerts(filter.id) });
  return (
    <section aria-labelledby="track-alerts-title" className="mt-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="track-alerts-title" className="flex items-center gap-2 text-md font-semibold"><Bell className="size-4 text-text-muted" aria-hidden />Alertes de tendance</h2>
          {alerts.data ? <StatusBadge tone={alerts.data.rules.enabled ? "success" : "neutral"}>{alerts.data.rules.enabled ? "Activées" : "Coupées"}</StatusBadge> : null}
        </div>
        <QueryBoundary query={alerts} skeleton="spinner">{(a) => <AlertsBody filterId={filter.id} data={a} canWrite={canWrite} />}</QueryBoundary>
      </Card>
    </section>
  );
}

function AlertsBody({ filterId, data, canWrite }: { filterId: string; data: TrackFilterAlerts; canWrite: boolean }) {
  const client = useClient();
  const [rules, setRules] = useState<TrackAlertRules>(data.rules);
  useEffect(() => { setRules(data.rules); }, [data.rules]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(data.rules);
  const save = useAppMutation((r: TrackAlertRules) => client.updateTrackFilterAlerts(filterId, r), { invalidate: ["track-alerts", "track-filters"], success: (d) => (d.rules.enabled ? "Alertes enregistrées" : "Alertes coupées") });
  const set = <K extends "medianPrice" | "newListings" | "daysToSell">(k: K, patch: Partial<TrackAlertRules[K]>) => setRules((r) => ({ ...r, [k]: { ...r[k], ...patch } }));
  const disabled = !canWrite || save.isPending;
  return (
    <div className="mt-3 flex flex-col gap-4">
      <Toggle checked={rules.enabled} onChange={(v) => setRules((r) => ({ ...r, enabled: v }))} disabled={disabled} label="Recevoir les alertes de ce filtre" description={`Évaluées après chaque lecture ; une alerte par règle au plus toutes les ${data.cooldownHours} h.`} />
      <div className={rules.enabled ? "flex flex-col gap-3" : "flex flex-col gap-3 opacity-60"}>
        <RuleRow label={TRACK_ALERT_RULE_LABELS.median_price} checked={rules.medianPrice.enabled} onToggle={(v) => set("medianPrice", { enabled: v })} disabled={disabled || !rules.enabled}
          input={<NumberField label="Écart du prix médian, en %" value={rules.medianPrice.percent} min={5} max={90} suffix="%" disabled={disabled || !rules.enabled || !rules.medianPrice.enabled} onChange={(v) => set("medianPrice", { percent: v })} />}
          hint="Hausse ou baisse face à la médiane des 7 jours précédents." />
        <RuleRow label={TRACK_ALERT_RULE_LABELS.new_listings} checked={rules.newListings.enabled} onToggle={(v) => set("newListings", { enabled: v })} disabled={disabled || !rules.enabled}
          input={<NumberField label="Seuil de nouvelles annonces par lecture" value={rules.newListings.threshold} min={1} max={96} suffix="annonces" disabled={disabled || !rules.enabled || !rules.newListings.enabled} onChange={(v) => set("newListings", { threshold: v })} />}
          hint="Nouvelles annonces depuis la lecture précédente (toutes les 2 h)." />
        <RuleRow label={TRACK_ALERT_RULE_LABELS.days_to_sell} checked={rules.daysToSell.enabled} onToggle={(v) => set("daysToSell", { enabled: v })} disabled={disabled || !rules.enabled}
          input={<NumberField label="Baisse du délai de vente, en %" value={rules.daysToSell.percent} min={10} max={90} suffix="%" disabled={disabled || !rules.enabled || !rules.daysToSell.enabled} onChange={(v) => set("daysToSell", { percent: v })} />}
          hint="Délai médian des annonces disparues (vendues ou retirées : une estimation)." />
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate(rules)} disabled={!dirty || save.isPending} loading={save.isPending}>Enregistrer</Button>
          {data.rules.enabled ? <Button variant="secondary" onClick={() => save.mutate({ ...rules, enabled: false })} disabled={save.isPending}>Tout couper</Button> : null}
        </div>
      ) : <p className="text-sm text-text-muted">Votre rôle permet de lire les alertes, pas de les régler.</p>}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Dernières alertes</h3>
        {data.events.length === 0 ? (
          <p className="text-sm text-text-muted">{data.rules.enabled ? "Aucune alerte pour l'instant : elles apparaîtront ici après les prochaines lectures." : "Aucune alerte : activez une règle pour être prévenu quand la tendance bouge."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2.5 text-sm">
                <span className="text-text">{e.message}</span>
                <span className="text-xs text-text-muted">{formatDateTime(e.createdAt)} · {TRACK_ALERT_RULE_LABELS[e.rule]}{e.source === "demo" ? " · données de démonstration" : ""}{e.notified ? " · notification envoyée" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* La mention « données de démonstration » est déjà en tête de page ; chaque alerte simulée le dit aussi. */}
      <TrackNotices notices={data.notices.filter((n) => n !== TRACK_DEMO_NOTICE)} />
    </div>
  );
}

function RuleRow({ label, hint, checked, onToggle, disabled, input }: { label: string; hint: string; checked: boolean; onToggle: (v: boolean) => void; disabled: boolean; input: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <Toggle className="min-w-0 flex-1" checked={checked} onChange={onToggle} disabled={disabled} label={label} description={hint} />
      <div className="sm:w-56">{input}</div>
    </div>
  );
}

function NumberField({ label, value, min, max, suffix, disabled, onChange }: { label: string; value: number; min: number; max: number; suffix: string; disabled: boolean; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <label className="flex items-center gap-2 text-sm text-text-muted">
      <span className="sr-only">{label}</span>
      <Input type="number" inputMode="numeric" min={min} max={max} value={text} disabled={disabled} aria-label={label} className="w-24" onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (Number.isInteger(n) && n >= min && n <= max) onChange(n); }} onBlur={() => { const v = clampInt(text, min, max, value); setText(String(v)); onChange(v); }} />
      <span>{suffix}</span>
    </label>
  );
}
