import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, Clock, Play, ShieldCheck, X } from "lucide-react";
import { purchaseCost, scoreBand } from "@selio/domain";
import type { AutoBuySettings, BuyerFees } from "@selio/contracts";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Toggle, cn, formatCents, formatDateTime } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { BandBadge, ScoreLegend } from "../components/deals";
import { ScoreRing } from "../../components/charts";

function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function AutoBuy() {
  const client = useClient();
  const session = useRequiredSession();
  const now = useNow();
  const [settings, setSettings] = useState<AutoBuySettings>(session.org.settings.autoBuy);
  const [fees, setFees] = useState<BuyerFees>(session.org.settings.buyerFees);
  const [lastRun, setLastRun] = useState<Awaited<ReturnType<typeof client.runAutoBuy>> | null>(null);
  const purchases = useQuery({ queryKey: ["purchases"], queryFn: () => client.listPurchaseRequests() });
  const canAdmin = session.role === "owner" || session.role === "admin";
  const canBuy = session.role !== "viewer";
  const dirty = JSON.stringify(settings) !== JSON.stringify(session.org.settings.autoBuy) || JSON.stringify(fees) !== JSON.stringify(session.org.settings.buyerFees);

  const save = useAppMutation(() => client.updateOrg({ settings: { autoBuy: settings, buyerFees: fees } }), { invalidate: ["session"], success: "Réglages de l'achat auto enregistrés" });
  const run = useAppMutation(() => client.runAutoBuy(), { invalidate: ["purchases", "opportunities", "nav-counts"], success: (r) => (r.bought > 0 ? `${r.bought} achat(s) automatique(s) simulé(s) pour ${formatCents(r.spentCents)}` : "Aucune affaire ne remplit les conditions"), onSuccess: (r) => setLastRun(r) });
  const cancel = useAppMutation((id: string) => client.cancelPurchaseRequest(id), { invalidate: ["purchases", "opportunities", "nav-counts"], success: "Achat automatique annulé" });

  const today = now.toISOString().slice(0, 10);
  const spentToday = (purchases.data ?? []).filter((p) => (p.status === "simulated" || p.status === "executed") && (p.executedAt ?? "").slice(0, 10) === today).reduce((s, p) => s + p.maxPriceCents, 0);
  const band = scoreBand(settings.threshold);
  const example = purchaseCost({ priceCents: 2000, shippingCents: 450 }, fees);

  return (
    <>
      <PageHeader
        title="Achat auto"
        description="Réglez un seuil de note (par exemple 85/100). Au-dessus, l'application achète seule les affaires repérées par le radar, dans la limite d'un plafond par jour. Vous vérifiez ensuite l'achat, et vous pouvez l'annuler pendant un court délai."
        actions={<Button variant="secondary" icon={<Play />} onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={!canBuy || !session.org.settings.autoBuy.enabled}>Lancer maintenant</Button>}
      />
      <Alert tone="warning" className="mb-5" title="Achats simulés">L'achat réel sur Vinted est désactivé : il n'existe pas d'API acheteur officielle et les conditions d'annulation côté Vinted restent à vérifier techniquement. Chaque achat automatique est simulé de bout en bout et clairement marqué.</Alert>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <Toggle label="Activer l'achat automatique" description={settings.enabled ? "Activé : chaque analyse du radar peut déclencher des achats." : "Désactivé : les affaires restent à valider à la main."} checked={settings.enabled} onChange={(v) => setSettings({ ...settings, enabled: v })} disabled={!canAdmin} />
            <div className="mt-5">
              <div className="flex items-end justify-between gap-3">
                <label htmlFor="threshold" className="text-sm font-medium text-text">Seuil de déclenchement</label>
                <span className="flex items-center gap-2"><ScoreRing score={settings.threshold} size={44} stroke={5} /><BandBadge score={settings.threshold} /></span>
              </div>
              <input id="threshold" type="range" min={50} max={100} step={1} value={settings.threshold} onChange={(e) => setSettings({ ...settings, threshold: Number(e.target.value) })} disabled={!canAdmin} className="mt-3 w-full accent-[var(--accent)]" />
              <p className="mt-1 text-xs text-text-muted">{band.label} — {band.advice}. Conseil : 85 ou plus.</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Field label="Plafond par jour" hint="Port et frais inclus.">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={settings.dailyCapCents} onChange={(v) => setSettings({ ...settings, dailyCapCents: v ?? 0 })} allowEmpty={false} disabled={!canAdmin} />}</Field>
              <Field label="Prix max par article" hint="Total payé.">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={settings.maxItemCents} onChange={(v) => setSettings({ ...settings, maxItemCents: v ?? 0 })} allowEmpty={false} disabled={!canAdmin} />}</Field>
              <Field label="Délai pour annuler">{(p) => <Select id={p.id} value={String(settings.cancelWindowMinutes)} onChange={(e) => setSettings({ ...settings, cancelWindowMinutes: Number(e.target.value) })} disabled={!canAdmin}>{[0, 10, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m === 0 ? "Aucun" : `${m} min`}</option>)}</Select>}</Field>
            </div>
          </Card>
          <Card>
            <h2 className="text-md font-semibold">Coût réel d'un achat</h2>
            <p className="mt-1 text-sm text-text-muted">Frais payés par l'acheteur en plus du prix et du port (protection acheteurs). Ils entrent dans le total, la marge et le plafond.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Part fixe">{(p) => <MoneyInput id={p.id} value={fees.fixedCents} onChange={(v) => setFees({ ...fees, fixedCents: v ?? 0 })} allowEmpty={false} disabled={!canAdmin} />}</Field>
              <Field label="Pourcentage du prix">{(p) => <Input id={p.id} type="number" min={0} max={30} step={0.5} value={Math.round(fees.rate * 1000) / 10} onChange={(e) => setFees({ ...fees, rate: Math.max(0, Math.min(0.3, Number(e.target.value) / 100)) })} suffix={<span className="text-sm">%</span>} disabled={!canAdmin} />}</Field>
            </div>
            <p className="num mt-3 rounded-md bg-surface-muted px-3 py-2 text-sm">Exemple : 20,00 € + port 4,50 € + protection {formatCents(example.protectionCents)} = <span className="font-semibold">{formatCents(example.totalCents)}</span></p>
            <div className="mt-4 flex justify-end gap-2">
              {dirty ? <Button variant="ghost" onClick={() => { setSettings(session.org.settings.autoBuy); setFees(session.org.settings.buyerFees); }}>Annuler</Button> : null}
              <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty || !canAdmin}>Enregistrer</Button>
            </div>
          </Card>
          <Card>
            <div className="mb-3 flex items-center gap-2"><ShieldCheck className="size-4 text-text-muted" aria-hidden /><h2 className="text-md font-semibold">Garde-fous</h2></div>
            <ul className="grid gap-1.5 text-sm text-text-muted sm:grid-cols-2">
              {["Seuil de note réglable", "Plafond de dépense par jour", "Prix maximal par article", "Délai d'annulation après achat", "Jamais deux achats pour la même annonce", "Marge estimée positive obligatoire"].map((g) => <li key={g} className="flex items-center gap-1.5"><Check className="size-3.5 text-success" aria-hidden />{g}</li>)}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-md font-semibold">Dépensé aujourd'hui</h2>
              <span className="num text-sm text-text-muted">{formatCents(spentToday)} / {formatCents(session.org.settings.autoBuy.dailyCapCents)}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-accent-vivid" style={{ width: `${Math.min(100, (spentToday / Math.max(1, session.org.settings.autoBuy.dailyCapCents)) * 100)}%` }} /></div>
            {lastRun ? (
              <div className="mt-3 rounded-md bg-surface-muted p-3 text-sm">
                <p className="font-medium text-text">Dernier passage : {lastRun.evaluated} affaire(s) examinée(s), {lastRun.bought} achetée(s).</p>
                {lastRun.skipped.length ? <ul className="mt-1 text-xs text-text-muted">{lastRun.skipped.map((s) => <li key={s.reason}>{s.count} × {s.reason}</li>)}</ul> : null}
              </div>
            ) : null}
          </Card>
          <div>
            <h2 className="mb-2 text-md font-semibold">Achats automatiques</h2>
            <QueryBoundary query={purchases} empty={(d) => d.filter((p) => p.mode === "auto").length === 0 ? <EmptyState icon={<Bot />} title="Aucun achat automatique" description="Activez l'achat auto puis lancez une analyse dans « Bonnes affaires »." action={<Link to="/app/radar"><Button variant="secondary">Bonnes affaires</Button></Link>} /> : null}>
              {(list) => (
                <ul className="flex flex-col gap-3">
                  {list.filter((p) => p.mode === "auto").map((p) => {
                    const left = p.cancelableUntil ? Math.ceil((new Date(p.cancelableUntil).getTime() - now.getTime()) / 60_000) : 0;
                    const cancelable = (p.status === "simulated" || p.status === "executed") && left > 0;
                    const o = p.opportunity;
                    return (
                      <li key={p.id} className={cn("card flex flex-wrap items-center gap-3 p-3", cancelable && "border-accent/50")}>
                        {o?.observed.photoUrl ? <img src={o.observed.photoUrl} alt="" className="size-16 rounded-md object-cover" /> : <span className="size-16 rounded-md bg-surface-muted" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-text">{o?.title ?? "Affaire supprimée"}</p>
                          <p className="num text-xs text-text-muted">{formatDateTime(p.createdAt)} · total {formatCents(p.maxPriceCents)}{o ? ` · bénéfice estimé ${formatCents(o.estimate.marginCents)}` : ""}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <StatusBadge tone={p.status === "cancelled" ? "muted" : p.status === "blocked" ? "danger" : "success"}>{p.status === "cancelled" ? "Annulé" : p.status === "blocked" ? "Bloqué" : "Acheté (simulé)"}</StatusBadge>
                            {cancelable ? <span className="num inline-flex items-center gap-1 text-xs font-medium text-accent"><Clock className="size-3.5" aria-hidden />Annulable encore {left} min</span> : null}
                          </div>
                        </div>
                        {o ? <ScoreRing score={o.score} size={44} /> : null}
                        {cancelable && canBuy ? <Button size="sm" variant="secondary" icon={<X />} onClick={() => cancel.mutate(p.id)} loading={cancel.isPending && cancel.variables === p.id}>Annuler l'achat</Button> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </QueryBoundary>
          </div>
          <Card>
            <h2 className="mb-3 text-md font-semibold">Comment l'IA note une affaire</h2>
            <ScoreLegend threshold={settings.threshold} />
          </Card>
        </div>
      </div>
    </>
  );
}
