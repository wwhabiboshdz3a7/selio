import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Ban, Cloud, Hourglass, Laptop, Lock, Play, Power, Server, Sparkles } from "lucide-react";
import { BOT_PLACE_LABELS, BOT_STATE_LABELS, BOT_STOP_TEXT, PLAN_LABELS, isPlan, type BotAction, type BotId, type BotPlace, type BotState, type BotSummary, type BotView } from "@selio/contracts";
import { Alert, Button, ConfirmDialog, StatStrip, StatusBadge, buttonClass, cn, formatDateTime, formatNumber, formatRelative, type StatusTone } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { useAppMutation } from "../../components/hooks";

/**
 * État des automatisations de compte de Selio Manager (négociation par IA, relances, republication,
 * réponses, messages aux favoris, après-vente) et coupe-circuit de l'organisation, « Arrêter toutes les
 * automatisations ». Les données viennent de la synthèse GET /api/bot (routes gardées telles quelles) ;
 * l'achat automatique, lui, appartient à Selio Bot (/bot/achat-auto) et n'apparaît ici que comme lien.
 */

/** Clés de cache touchées par l'arrêt et la reprise (le même interrupteur que l'arrêt global). */
export const STOP_KEYS = ["bot", "automation-state", "radar-auto", "overview", "rules", "nav-counts"];

export function useAutomationSummary() {
  const client = useClient();
  return useQuery({ queryKey: ["bot"], queryFn: () => client.botSummary(), refetchInterval: 30_000 });
}

/** Page de réglage de chaque automatisation dans Selio Manager (l'achat automatique vit dans Selio Bot). */
export const AUTOMATION_PATHS: Record<BotId, string> = {
  negotiation: "/app/automatisation/negociation",
  follow_up: "/app/automatisation/relances",
  republish: "/app/automatisation/republication",
  replies: "/app/automatisation/reponse",
  favorites: "/app/automatisation/favoris",
  after_sale: "/app/automatisation/apres-vente",
  auto_buy: "/bot/achat-auto",
};

/** Anciennes adresses de l'espace Bot (/bot/negociation…) : chacune mène à sa page dans Selio Manager. */
export const LEGACY_BOT_SLUGS: Record<string, BotId> = {
  negociation: "negotiation",
  relance: "follow_up",
  republication: "republish",
  reponses: "replies",
  favoris: "favorites",
  "apres-vente": "after_sale",
};

/** Automatisations de compte (Selio Manager) : tout sauf l'achat automatique. */
export function accountAutomations(bots: BotView[]): BotView[] {
  return bots.filter((b) => b.id !== "auto_buy");
}

const STATE_TONE: Record<BotState, StatusTone> = {
  on: "success",
  off: "muted",
  stopped: "danger",
  waiting_cloud: "warning",
  locked: "neutral",
  plan_unavailable: "muted",
  soon: "accent",
};

export function BotStateBadge({ state }: { state: BotState }) {
  return <StatusBadge tone={STATE_TONE[state]} data-bot-state={state}>{BOT_STATE_LABELS[state]}</StatusBadge>;
}

const PLACE_ICON: Record<BotPlace, ReactNode> = {
  cloud: <Cloud />,
  extension: <Laptop />,
  server: <Server />,
  none: <Hourglass />,
};

/** Où tourne l'automatisation : icône, nom court et phrase. */
export function BotPlaceLine({ place, detail, className }: { place: BotPlace; detail: string; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-text-muted [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", className)}>
      {PLACE_ICON[place]}
      <span><span className="font-medium text-text">{BOT_PLACE_LABELS[place]}</span> — {detail}</span>
    </p>
  );
}

const ACTION_TONE: Record<BotAction["status"], StatusTone> = { done: "success", pending: "warning", failed: "danger", skipped: "muted" };
const ACTION_LABEL: Record<BotAction["status"], string> = { done: "Faite", pending: "En attente", failed: "En échec", skipped: "Écartée" };

/** Dernières actions (journal des tâches, demandes d'achat). */
export function BotRecent({ actions, max = 5, empty = "Aucune action pour l'instant." }: { actions: BotAction[]; max?: number; empty?: string }) {
  if (actions.length === 0) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {actions.slice(0, max).map((a, i) => (
        <li key={`${a.at}-${i}`} className="flex items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm text-text">{a.label}</p>
            <p className="num text-xs text-text-muted">{formatRelative(a.at)}</p>
          </div>
          <StatusBadge tone={ACTION_TONE[a.status]} className="shrink-0">{ACTION_LABEL[a.status]}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

/**
 * « Arrêter toutes les automatisations » / « Reprendre » : coupe-circuit de l'organisation (titulaire et
 * administrateur). Il coupe aussi la lecture en direct et l'achat automatique de Selio Bot. Les autres rôles
 * voient l'état, sans bouton actif.
 */
export function StopAllButton({ summary, size }: { summary: BotSummary; size?: "sm" | "md" }) {
  const client = useClient();
  const [confirm, setConfirm] = useState(false);
  const stop = useAppMutation(() => client.stopBots(), { invalidate: STOP_KEYS, success: "Toutes les automatisations sont arrêtées jusqu'à la reprise" });
  const resume = useAppMutation(() => client.resumeBots(), { invalidate: STOP_KEYS, success: "Automatisations reprises : chacune retrouve son réglage" });
  const title = summary.canManage ? undefined : "Réservé au titulaire et aux administrateurs";
  return (
    <>
      {summary.stopped
        ? <Button variant="secondary" size={size} icon={<Play />} onClick={() => resume.mutate(undefined)} loading={resume.isPending} disabled={!summary.canManage} title={title}>Reprendre les automatisations</Button>
        : <Button variant="danger" size={size} icon={<Power />} onClick={() => setConfirm(true)} disabled={!summary.canManage} title={title}>Arrêter toutes les automatisations</Button>}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => { stop.mutate(undefined); setConfirm(false); }}
        loading={stop.isPending}
        title="Arrêter toutes les automatisations ?"
        description={BOT_STOP_TEXT}
        confirmLabel="Tout arrêter"
        danger
      />
    </>
  );
}

/** Bandeau du coupe-circuit actif. */
export function StoppedAlert({ summary, children }: { summary: BotSummary; children?: ReactNode }) {
  if (!summary.stopped) return null;
  return (
    <Alert tone="danger" className="mb-4" title="Toutes les automatisations sont arrêtées">
      Coupe-circuit actif{summary.stoppedAt ? <> depuis le <span className="num">{formatDateTime(summary.stoppedAt)}</span></> : null} : {children ?? "aucune automatisation n'agit, ni dans Selio Cloud ni sur le serveur. Les tâches en file attendent la reprise."}{summary.canManage ? "" : " Seuls le titulaire et les administrateurs peuvent reprendre."}
    </Alert>
  );
}

/** État de Selio Cloud vu des automatisations, avec le lien vers les comptes connectés dans le Cloud. */
export function CloudLine({ cloud, className, stacked = false }: { cloud: BotSummary["cloud"]; className?: string; /** Colonne étroite : bouton sous le texte. */ stacked?: boolean }) {
  const status = cloud.ready
    ? { tone: "success" as const, label: "Prêt", text: `${cloud.activeAccounts} compte${cloud.activeAccounts > 1 ? "s" : ""} actif${cloud.activeAccounts > 1 ? "s" : ""} sur ${cloud.accounts} : les automatisations compatibles tournent ordinateur éteint, de ${cloud.activeHours.startHour} h à ${cloud.activeHours.endHour} h.` }
    : !cloud.available
      ? { tone: "muted" as const, label: "Pas sur ce forfait", text: cloud.reason }
      : cloud.serverEnabled === false
        ? { tone: "warning" as const, label: "Fermé sur ce serveur", text: "Selio Cloud reste fermé tant que l'avis juridique n'est pas rendu : les automatisations passent par l'extension, ordinateur allumé." }
        : { tone: "warning" as const, label: "Aucun compte actif", text: `${cloud.accounts === 0 ? "Aucun compte Vinted relié au Cloud" : `${cloud.activeAccounts} compte actif sur ${cloud.accounts}`}${cloud.consent ? "" : ", accord à accepter"} : en attendant, les automatisations passent par l'extension, ordinateur allumé.` };
  return (
    <div className={cn("flex flex-col gap-2", !stacked && "sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&>svg]:size-[18px]" aria-hidden><Cloud /></span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">Selio Cloud <StatusBadge tone={status.tone}>{status.label}</StatusBadge></p>
          <p className="text-sm text-text-muted">{status.text}</p>
        </div>
      </div>
      <Link to="/cloud/comptes" className={cn(buttonClass({ variant: "secondary", size: "sm" }), "shrink-0 self-start", !stacked && "sm:self-center")}>Comptes dans le Cloud</Link>
    </div>
  );
}

/** Icône d'une automatisation « bientôt », verrouillée ou coupée. */
export function BotStateIcon({ state }: { state: BotState }) {
  if (state === "soon") return <Sparkles className="size-4 text-accent" aria-hidden />;
  if (state === "locked") return <Lock className="size-4 text-text-muted" aria-hidden />;
  if (state === "stopped") return <Ban className="size-4 text-danger" aria-hidden />;
  return null;
}

/**
 * Tableau d'état des automatisations de compte, en tête de « Tout le parcours » : chaque automatisation,
 * son état, où elle tourne, ses dernières actions et sa page ; « Arrêter toutes les automatisations ».
 */
export function AutomationStatusBoard({ summary }: { summary: BotSummary }) {
  const list = accountAutomations(summary.bots);
  const on = list.filter((b) => b.state === "on").length;
  const planLabel = isPlan(summary.plan) ? PLAN_LABELS[summary.plan] : summary.plan;
  return (
    <section aria-labelledby="etat-automatisations" className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="etat-automatisations" className="text-sm font-bold tracking-wider text-text uppercase">État des automatisations</h2>
          <p className="mt-0.5 text-sm text-text-muted">Où chacune tourne (Selio Cloud ordinateur éteint, l'extension ou le serveur), ses dernières actions, et l'arrêt d'urgence.</p>
        </div>
        <StopAllButton summary={summary} />
      </div>
      <StoppedAlert summary={summary} />
      {summary.simulated ? <p className="mb-3 text-xs text-text-muted">Démonstration : rien n'est envoyé, les automatisations montrent ce qu'elles feraient avec vos règles.</p> : null}
      {!summary.canManage ? <p className="mb-3 text-sm text-text-muted">Consultation : seuls le titulaire et les administrateurs peuvent arrêter ou reprendre toutes les automatisations.</p> : null}
      <StatStrip
        className="mb-4 grid-cols-2 lg:grid-cols-3"
        items={[
          { label: "Automatisations allumées", value: <>{formatNumber(on)}<span className="text-base font-medium text-text-muted"> / {list.length}</span></>, sub: summary.stopped ? "coupées par l'arrêt d'urgence" : "les autres sont arrêtées, en attente ou bientôt là" },
          { label: "Actions aujourd'hui", value: formatNumber(summary.actionsToday), sub: `plafond de l'offre ${planLabel} : ${formatNumber(summary.actionsPerDay)} par jour` },
          { label: "Selio Cloud", value: summary.cloud.ready ? "Prêt" : "Pas encore", sub: summary.cloud.ready ? `${summary.cloud.activeAccounts} compte(s) actif(s)` : "les automatisations passent par l'extension" },
        ]}
      />
      <div className="card overflow-x-auto p-0">
        <table data-stack className="w-full min-w-[760px] text-sm" aria-label="État des automatisations">
          <thead>
            <tr className="border-b border-border text-left">{["Automatisation", "État", "Où elle tourne", "Dernière action", ""].map((h) => <th key={h} className="th-label px-4 py-2.5 first:pl-5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id} data-bot={b.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3 pl-5">
                  <p className="flex items-center gap-1.5 font-semibold text-text"><Link to={AUTOMATION_PATHS[b.id]} className="tap-target hover:underline underline-offset-2">{b.name}</Link><BotStateIcon state={b.state} /></p>
                  <p className="mt-0.5 max-w-xs text-xs text-text-muted">{b.stateDetail}</p>
                </td>
                <td data-label="État" className="px-4 py-3"><BotStateBadge state={b.state} /></td>
                <td data-label="Où elle tourne" className="px-4 py-3"><BotPlaceLine place={b.place} detail={b.placeDetail} className="max-w-xs text-xs" /></td>
                <td data-label="Dernière action" className="px-4 py-3 text-xs text-text-muted">{b.recent[0] ? <><span className="block truncate text-text">{b.recent[0].label}</span><span className="num">{formatRelative(b.recent[0].at)}</span></> : "—"}</td>
                <td className="px-4 py-3 text-right"><Link to={AUTOMATION_PATHS[b.id]} className="tap-target inline-flex items-center gap-1 text-sm font-semibold whitespace-nowrap text-accent">Régler <ArrowRight className="size-4" aria-hidden /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-text-muted">L'arrêt d'urgence coupe aussi la lecture en direct et l'achat automatique de <Link to="/bot" className="font-medium text-accent underline-offset-2 hover:underline">Selio Bot</Link>. Tout est journalisé : <Link to="/app/automations?tab=jobs" className="font-medium text-accent underline-offset-2 hover:underline">file et historique des tâches</Link>, <Link to="/cloud/journal" className="font-medium text-accent underline-offset-2 hover:underline">journal de Selio Cloud</Link>.</p>
    </section>
  );
}
