import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, CheckCircle2, Clock, Lock, LockOpen, Play, ShieldCheck, Smartphone, X } from "lucide-react";
import { RADAR_3DS_TIMEOUT_MINUTES, type AutoBuySettings, type BuyerFees, type MarketplaceConnection } from "@selio/contracts";
import { can, isActiveAccount, purchaseCost, scoreBand } from "@selio/domain";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Toggle, cn, formatCents, formatDateTime } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import type { AutoBuyRunResult, AutoBuyStatus, RadarAutoLock } from "../../lib/data/types";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { BandBadge, ScoreLegend } from "../components/deals";
import { PurchaseStatusBadge, RADAR_KEYS, useAutoBuyStatus } from "../components/radar";
import { ScoreRing } from "../../components/charts";

function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Lien utile pour lever un verrou (le client ne lève jamais le verrou serveur lui-même). */
const LOCK_LINK: Record<string, { to: string; label: string }> = {
  cloud: { to: "/cloud/comptes", label: "Comptes Cloud" },
  consent: { to: "/cloud/accord", label: "Accord Cloud" },
};

/**
 * Radar Auto (achat automatique) : derrière deux verrous (RADAR_AUTO_ENABLED côté serveur, réglage de
 * l'organisation), le compte Achat relié au Cloud et l'accord ; pas activable pour les clients sur
 * l'adresse partagée tant qu'Ibrahim n'a pas tranché. Tout est en lecture seule tant que le verrou
 * serveur est fermé. Paiement par le porte-monnaie Vinted ; une validation 3-D Secure attend le client.
 */
export default function AutoBuy() {
  const status = useAutoBuyStatus();
  return (
    <>
      <PageHeader
        eyebrow="Radar Auto"
        title="Achat auto"
        description="Au-dessus d'un seuil de note, dans la limite d'un prix maximum par article et d'un plafond par jour, Radar Auto achète avec le porte-monnaie Vinted de votre compte Achat. Vous pouvez annuler pendant un court délai."
      />
      <QueryBoundary query={status} skeleton="spinner">{(s) => <AutoBuyBody status={s} />}</QueryBoundary>
    </>
  );
}

function AutoBuyBody({ status }: { status: AutoBuyStatus }) {
  const client = useClient();
  const session = useRequiredSession();
  const { id: focusId } = useParams();
  const now = useNow();
  const [settings, setSettings] = useState<AutoBuySettings>(status.settings);
  const [fees, setFees] = useState<BuyerFees>(session.org.settings.buyerFees);
  const [lastRun, setLastRun] = useState<AutoBuyRunResult | null>(null);
  // Réglages relus du serveur (après un enregistrement) : le formulaire repart de la valeur enregistrée.
  useEffect(() => {
    setSettings(status.settings);
  }, [status.settings]);
  const purchases = useQuery({ queryKey: ["purchases"], queryFn: () => client.listPurchaseRequests() });
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  // Comptes « Achat » actifs : jamais un compte Vente ou Perso.
  const purchaseAccounts = (connections.data ?? []).filter((c) => c.usage === "purchase" && isActiveAccount(c));
  const accountLabel = (id: string | null) => {
    const c = id ? connections.data?.find((x) => x.id === id) : null;
    if (!c) return null;
    return typeof c.config.displayHandle === "string" && c.config.displayHandle ? `@${c.config.displayHandle}` : c.label;
  };
  const isOwner = can(session.role, "purchase.execute");
  const canBuy = can(session.role, "purchase.simulate");
  const canEditFees = can(session.role, "org.update");
  // Lecture seule tant que le verrou serveur est fermé : rien n'est activable pour un client.
  const editable = status.serverEnabled && isOwner;
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(status.settings);
  const feesDirty = JSON.stringify(fees) !== JSON.stringify(session.org.settings.buyerFees);

  const save = useAppMutation(() => {
    const { enabledAt: _a, enabledBy: _b, ...rest } = settings;
    return client.updateRadarSettings({ autoBuy: rest });
  }, { invalidate: ["session", "radar-auto"], success: "Réglages de Radar Auto enregistrés" });
  const saveFees = useAppMutation(() => client.updateOrg({ settings: { buyerFees: fees } }), { invalidate: ["session"], success: "Frais d'achat enregistrés" });
  const run = useAppMutation(() => client.runAutoBuy(), {
    invalidate: RADAR_KEYS,
    success: (r) => (r.disabled ? null : r.bought > 0 ? `${r.bought} achat(s) automatique(s) ${r.realPurchase ? "" : "simulé(s) "}pour ${formatCents(r.spentCents)}` : "Aucune affaire ne remplit les conditions"),
    onSuccess: (r) => setLastRun(r),
  });
  const cancel = useAppMutation((id: string) => client.cancelPurchaseRequest(id), { invalidate: RADAR_KEYS, success: "Achat automatique annulé" });
  const resume = useAppMutation((id: string) => client.resumePurchase(id), {
    invalidate: RADAR_KEYS,
    success: (r) => (r.queued ? "Vérification du paiement lancée : le résultat s'affiche ici dans un instant" : r.purchase.status === "awaiting_3ds" ? "Paiement pas encore confirmé : validez dans l'application de votre banque" : "Paiement vérifié"),
  });

  const today = now.toISOString().slice(0, 10);
  const spentToday = (purchases.data ?? []).filter((p) => (p.status === "simulated" || p.status === "executed") && (p.executedAt ?? "").slice(0, 10) === today).reduce((s, p) => s + (p.totalCents ?? p.maxPriceCents), 0);
  const band = scoreBand(settings.threshold);
  const example = purchaseCost({ priceCents: 2000, shippingCents: 450 }, fees);
  const autoList = (purchases.data ?? []).filter((p) => p.mode === "auto");
  const waiting3ds = autoList.filter((p) => p.status === "awaiting_3ds").length;

  return (
    <>
      <Alert tone="warning" className="mb-4" title="Non activé pour les clients">{status.notice}</Alert>
      {!status.realPurchase ? (
        <Alert tone="info" className="mb-5" title="Achat réel désactivé (D11)">Même verrous levés, le parcours s'arrête avant le bouton de paiement : chaque achat automatique est enregistré « simulé », aucun paiement ni commande réels.</Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card aria-labelledby="locks-title">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 id="locks-title" className="text-md font-semibold">Verrous</h2>
              {status.active ? <StatusBadge tone="success">Radar Auto actif</StatusBadge> : <StatusBadge tone="muted">Radar Auto verrouillé</StatusBadge>}
            </div>
            <p className="mb-3 text-sm text-text-muted">{status.active ? "Tous les verrous sont levés : Radar Auto peut acheter au prochain passage." : "Radar Auto n'achète rien tant qu'un seul de ces verrous est fermé."}</p>
            <ul className="flex flex-col divide-y divide-border" aria-label="Verrous de Radar Auto">
              {status.locks.map((l) => <LockRow key={l.key} lock={l} />)}
            </ul>
            {status.simulated ? <p className="mt-3 text-xs text-text-muted">Démonstration : le serveur simulé garde Radar Auto fermé, comme le serveur réel (RADAR_AUTO_ENABLED=false).</p> : null}
          </Card>

          <Card aria-labelledby="auto-settings-title">
            <h2 id="auto-settings-title" className="text-md font-semibold">Réglages</h2>
            {!editable ? (
              <p className="mt-1 mb-3 flex items-start gap-1.5 text-sm text-text-muted" data-testid="auto-readonly">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                {status.serverEnabled ? "Lecture seule : seul le propriétaire du compte modifie Radar Auto." : "Lecture seule : le verrou du serveur est fermé. Radar Auto reste réservé aux comptes de l'équipe Selio, pour les tests."}
              </p>
            ) : null}
            <Toggle className="mt-3" label="Activer Radar Auto" description={settings.enabled ? "Activé : chaque lecture du radar peut déclencher un achat, si tous les verrous sont levés." : "Désactivé : les affaires restent à acheter vous-même en un clic."} checked={settings.enabled} onChange={(v) => setSettings({ ...settings, enabled: v })} disabled={!editable} />
            <div className="mt-5">
              <div className="flex items-end justify-between gap-3">
                <label htmlFor="threshold" className="text-sm font-medium text-text">Seuil de note</label>
                <span className="flex items-center gap-2"><ScoreRing score={settings.threshold} size={44} stroke={5} /><BandBadge score={settings.threshold} /></span>
              </div>
              <input id="threshold" type="range" min={50} max={100} step={1} value={settings.threshold} onChange={(e) => setSettings({ ...settings, threshold: Number(e.target.value) })} disabled={!editable} className="mt-3 w-full accent-[var(--accent)] disabled:opacity-60" />
              <p className="mt-1 text-xs text-text-muted">{band.label} — {band.advice}. Conseil : 85 ou plus.</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Field label="Prix max par article" hint="Total payé (port et frais inclus).">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={settings.maxItemCents} onChange={(v) => setSettings({ ...settings, maxItemCents: v ?? 0 })} allowEmpty={false} disabled={!editable} />}</Field>
              <Field label="Plafond par jour" hint="Tous achats auto du jour.">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={settings.dailyCapCents} onChange={(v) => setSettings({ ...settings, dailyCapCents: v ?? 0 })} allowEmpty={false} disabled={!editable} />}</Field>
              <Field label="Délai pour annuler">{(p) => <Select id={p.id} value={String(settings.cancelWindowMinutes)} onChange={(e) => setSettings({ ...settings, cancelWindowMinutes: Number(e.target.value) })} disabled={!editable}>{[0, 10, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m === 0 ? "Aucun" : `${m} min`}</option>)}</Select>}</Field>
            </div>
            <PurchaseAccountField accounts={purchaseAccounts} value={settings.connectionId} onChange={(id) => setSettings({ ...settings, connectionId: id })} disabled={!editable} />
            {editable ? (
              <div className="mt-4 flex justify-end gap-2">
                {settingsDirty ? <Button variant="ghost" onClick={() => setSettings(status.settings)}>Annuler</Button> : null}
                <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!settingsDirty}>Enregistrer</Button>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="text-md font-semibold">Coût réel d'un achat</h2>
            <p className="mt-1 text-sm text-text-muted">Frais payés par l'acheteur en plus du prix et du port (protection acheteurs). Ils entrent dans le total, la marge et le plafond, pour les achats « 1 clic » comme pour Radar Auto.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Part fixe">{(p) => <MoneyInput id={p.id} value={fees.fixedCents} onChange={(v) => setFees({ ...fees, fixedCents: v ?? 0 })} allowEmpty={false} disabled={!canEditFees} />}</Field>
              <Field label="Pourcentage du prix">{(p) => <Input id={p.id} type="number" min={0} max={30} step={0.5} value={Math.round(fees.rate * 1000) / 10} onChange={(e) => setFees({ ...fees, rate: Math.max(0, Math.min(0.3, Number(e.target.value) / 100)) })} suffix={<span className="text-sm">%</span>} disabled={!canEditFees} />}</Field>
            </div>
            <p className="num mt-3 rounded-md bg-surface-muted px-3 py-2 text-sm">Exemple : 20,00 € + port 4,50 € + protection {formatCents(example.protectionCents)} = <span className="font-semibold">{formatCents(example.totalCents)}</span></p>
            {canEditFees ? (
              <div className="mt-4 flex justify-end gap-2">
                {feesDirty ? <Button variant="ghost" onClick={() => setFees(session.org.settings.buyerFees)}>Annuler</Button> : null}
                <Button onClick={() => saveFees.mutate(undefined)} loading={saveFees.isPending} disabled={!feesDirty}>Enregistrer</Button>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2"><ShieldCheck className="size-4 text-text-muted" aria-hidden /><h2 className="text-md font-semibold">Garde-fous</h2></div>
            <ul className="grid gap-1.5 text-sm text-text-muted sm:grid-cols-2">
              {["Seuil de note réglable", "Plafond de dépense par jour", "Prix maximal par article", "Délai d'annulation après achat", "Jamais deux achats pour la même annonce", "Marge estimée positive obligatoire", "Arrêt au premier CAPTCHA ou avertissement", "3-D Secure : vous validez vous-même"].map((g) => <li key={g} className="flex items-center gap-1.5"><Check className="size-3.5 text-success" aria-hidden />{g}</li>)}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-md font-semibold">Dépensé aujourd'hui</h2>
              <span className="num text-sm text-text-muted">{formatCents(spentToday)} / {formatCents(status.settings.dailyCapCents)}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-accent-vivid" style={{ width: `${Math.min(100, (spentToday / Math.max(1, status.settings.dailyCapCents)) * 100)}%` }} /></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-text-muted">{status.active ? "Le worker passe à chaque lecture ; vous pouvez aussi lancer un passage." : "Verrouillé : aucun passage possible."}</p>
              <Button variant="secondary" size="sm" icon={<Play />} onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={!canBuy || !status.active}>Lancer maintenant</Button>
            </div>
            {lastRun ? (
              <div className="mt-3 rounded-md bg-surface-muted p-3 text-sm">
                {lastRun.disabled ? (
                  <>
                    <p className="font-medium text-text">Radar Auto verrouillé : rien n'a été évalué.</p>
                    <ul className="mt-1 list-disc pl-4 text-xs text-text-muted">{(lastRun.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-text">Dernier passage : {lastRun.evaluated} affaire(s) examinée(s), {lastRun.bought} achetée(s){lastRun.account ? ` avec « ${lastRun.account.label} »` : ""}.</p>
                    {lastRun.skipped.length ? <ul className="mt-1 text-xs text-text-muted">{lastRun.skipped.map((s) => <li key={s.reason}>{s.count} × {s.reason}</li>)}</ul> : null}
                  </>
                )}
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="mb-2 flex items-center gap-2"><Smartphone className="size-4 text-text-muted" aria-hidden /><h2 className="text-md font-semibold">Paiement et 3-D Secure</h2></div>
            <p className="text-sm text-text-muted">Le paiement passe par le porte-monnaie Vinted de votre compte Achat. Si votre banque demande une validation 3-D Secure, l'achat attend : vous recevez une notification, vous validez dans l'application de votre banque, puis vous touchez « J'ai validé ». Selio ne saisit jamais de code à votre place. Sans validation sous {RADAR_3DS_TIMEOUT_MINUTES} min, l'achat est abandonné.</p>
            {waiting3ds > 0 ? <p className="mt-2 text-sm font-medium text-warning">{waiting3ds} paiement(s) en attente de votre validation.</p> : null}
          </Card>

          <div>
            <h2 className="mb-2 text-md font-semibold">Achats automatiques</h2>
            <QueryBoundary query={purchases} empty={() => autoList.length === 0 ? <EmptyState icon={<Bot />} title="Aucun achat automatique" description="Radar Auto n'a encore rien acheté. Tant qu'il est verrouillé, achetez vous-même en un clic depuis une affaire." action={<Link to="/app/radar"><Button variant="secondary">Bonnes affaires</Button></Link>} /> : null}>
              {() => (
                <ul className="flex flex-col gap-3">
                  {autoList.map((p) => {
                    const left = p.cancelableUntil ? Math.ceil((new Date(p.cancelableUntil).getTime() - now.getTime()) / 60_000) : 0;
                    const cancelable = (p.status === "simulated" || p.status === "executed") && left > 0;
                    const waiting = p.status === "awaiting_3ds";
                    const leftFor3ds = waiting && p.awaiting3dsUntil ? Math.max(0, Math.ceil((new Date(p.awaiting3dsUntil).getTime() - now.getTime()) / 60_000)) : null;
                    const o = p.opportunity;
                    return (
                      <li key={p.id} id={`achat-${p.id}`} className={cn("card flex flex-wrap items-center gap-3 p-3", (cancelable || waiting) && "border-accent/50", focusId === p.id && "border-accent ring-1 ring-accent")} aria-label={`Achat ${o?.title ?? p.id}`}>
                        {o?.observed.photoUrl ? <img src={o.observed.photoUrl} alt="" className="size-16 rounded-md object-cover" /> : <span className="size-16 rounded-md bg-surface-muted" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-text">{o ? <Link to={`/app/radar/affaires/${o.id}`} className="hover:underline underline-offset-2">{o.title}</Link> : "Affaire supprimée"}</p>
                          <p className="num text-xs text-text-muted">{formatDateTime(p.createdAt)} · total {formatCents(p.totalCents ?? p.maxPriceCents)}{o ? ` · bénéfice estimé ${formatCents(o.estimate.marginCents)}` : ""}{accountLabel(p.connectionId) ? ` · ${accountLabel(p.connectionId)}` : ""}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <PurchaseStatusBadge status={p.status} />
                            {cancelable ? <span className="num inline-flex items-center gap-1 text-xs font-medium text-accent"><Clock className="size-3.5" aria-hidden />Annulable encore {left} min</span> : null}
                            {leftFor3ds !== null ? <span className="num inline-flex items-center gap-1 text-xs font-medium text-warning"><Clock className="size-3.5" aria-hidden />Encore {leftFor3ds} min pour valider</span> : null}
                          </div>
                          {p.resultNote ? <p className="mt-1 text-xs text-text-muted">{p.resultNote}</p> : null}
                        </div>
                        {o ? <ScoreRing score={o.score} size={44} /> : null}
                        {waiting && canBuy ? (
                          <span className="flex flex-wrap gap-1">
                            <Button size="sm" variant="accent" icon={<CheckCircle2 />} onClick={() => resume.mutate(p.id)} loading={resume.isPending && resume.variables === p.id}>J'ai validé</Button>
                            <Button size="sm" variant="ghost" icon={<X />} onClick={() => cancel.mutate(p.id)}>Abandonner</Button>
                          </span>
                        ) : null}
                        {cancelable && canBuy ? <Button size="sm" variant="secondary" icon={<X />} onClick={() => cancel.mutate(p.id)} loading={cancel.isPending && cancel.variables === p.id}>Annuler l'achat</Button> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </QueryBoundary>
          </div>
          <Card>
            <h2 className="mb-3 text-md font-semibold">Comment la note est lue</h2>
            <ScoreLegend threshold={settings.threshold} />
          </Card>
        </div>
      </div>
    </>
  );
}

function LockRow({ lock }: { lock: RadarAutoLock }) {
  const link = !lock.ok ? LOCK_LINK[lock.key] : undefined;
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm" data-lock={lock.key} data-ok={lock.ok ? "true" : "false"}>
      {lock.ok ? <LockOpen className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Lock className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-text">{lock.label}<StatusBadge tone={lock.ok ? "success" : "muted"}>{lock.ok ? "Levé" : "Fermé"}</StatusBadge></p>
        {lock.detail ? <p className="mt-0.5 text-xs text-text-muted">{lock.detail}</p> : null}
        {link ? <Link to={link.to} className="mt-0.5 inline-block text-xs font-medium text-accent underline-offset-2 hover:underline">{link.label}</Link> : null}
      </div>
    </li>
  );
}

/** Compte Vinted « Achat » utilisé par Radar Auto et par « À valider » (jamais un compte Perso). */
function PurchaseAccountField({ accounts, value, onChange, disabled }: { accounts: MarketplaceConnection[]; value: string | null; onChange: (id: string | null) => void; disabled: boolean }) {
  const name = (c: MarketplaceConnection) => (typeof c.config.displayHandle === "string" && c.config.displayHandle ? `@${c.config.displayHandle} — ${c.label}` : c.label);
  if (accounts.length === 0) {
    return (
      <div className="mt-5 rounded-md bg-surface-muted px-3 py-2.5 text-sm">
        <p className="font-medium text-text">Compte Achat utilisé</p>
        <p className="mt-0.5 text-xs text-text-muted">Aucun compte Vinted classé « Achat » : Radar Auto ne peut rien acheter. <Link to="/app/accounts?categorie=achat&ajouter=1" className="font-medium text-accent underline-offset-2 hover:underline">Ajouter un compte Achat</Link></p>
      </div>
    );
  }
  const current = accounts.find((c) => c.id === value) ?? null;
  return (
    <Field label="Compte Achat utilisé" className="mt-5" hint={<>Relié à Selio Cloud pour acheter. Les comptes Vente et Perso ne sont jamais utilisés. <Link to="/app/accounts?categorie=achat" className="underline underline-offset-2">Gérer les comptes</Link></>}>
      {(p) => (
        <Select id={p.id} aria-describedby={p.describedBy} value={current?.id ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
          <option value="">Automatique : {name(accounts[0]!)}</option>
          {accounts.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
        </Select>
      )}
    </Field>
  );
}
