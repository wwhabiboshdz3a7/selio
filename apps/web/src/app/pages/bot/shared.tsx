import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Ban, Cloud, Hourglass, Laptop, Lock, Play, Power, Server, Sparkles } from "lucide-react";
import { BOT_PLACE_LABELS, BOT_STATE_LABELS, BOT_STOP_TEXT, type BotAction, type BotId, type BotPlace, type BotState, type BotSummary } from "@selio/contracts";
import { Button, ConfirmDialog, StatusBadge, buttonClass, cn, formatRelative, type StatusTone } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { useAppMutation } from "../../components/hooks";

/** Clés de cache touchées par « Tout arrêter » et « Reprendre » (le même interrupteur que l'arrêt global). */
export const BOT_KEYS = ["bot", "automation-state", "radar-auto", "overview", "rules", "nav-counts"];

export function useBotSummary() {
  const client = useClient();
  return useQuery({ queryKey: ["bot"], queryFn: () => client.botSummary(), refetchInterval: 30_000 });
}

/** Adresse de la page d'un bot (slugs en français, sans accent). */
export const BOT_SLUGS: Record<BotId, string> = {
  negotiation: "negociation",
  follow_up: "relance",
  republish: "republication",
  replies: "reponses",
  favorites: "favoris",
  auto_buy: "achat-auto",
  after_sale: "apres-vente",
};

export function botPath(id: BotId): string {
  return `/bot/${BOT_SLUGS[id]}`;
}

export function botIdFromSlug(slug: string | undefined): BotId | null {
  const found = (Object.entries(BOT_SLUGS) as [BotId, string][]).find(([, s]) => s === slug);
  return found ? found[0] : null;
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

/** Où tourne le bot : icône, nom court et phrase. */
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

/** Dernières actions d'un bot (journal des tâches, demandes d'achat). */
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
 * « Tout arrêter » / « Reprendre » : coupe-circuit de l'organisation (titulaire et administrateur). Les
 * autres rôles voient l'état, sans bouton actif.
 */
export function StopAllButton({ summary, size }: { summary: BotSummary; size?: "sm" | "md" }) {
  const client = useClient();
  const [confirm, setConfirm] = useState(false);
  const stop = useAppMutation(() => client.stopBots(), { invalidate: BOT_KEYS, success: "Tout est arrêté : aucun bot n'agit jusqu'à la reprise" });
  const resume = useAppMutation(() => client.resumeBots(), { invalidate: BOT_KEYS, success: "Bots repris : chacun retrouve son réglage" });
  const title = summary.canManage ? undefined : "Réservé au titulaire et aux administrateurs";
  return (
    <>
      {summary.stopped
        ? <Button variant="secondary" size={size} icon={<Play />} onClick={() => resume.mutate(undefined)} loading={resume.isPending} disabled={!summary.canManage} title={title}>Reprendre</Button>
        : <Button variant="danger" size={size} icon={<Power />} onClick={() => setConfirm(true)} disabled={!summary.canManage} title={title}>Tout arrêter</Button>}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => { stop.mutate(undefined); setConfirm(false); }}
        loading={stop.isPending}
        title="Tout arrêter ?"
        description={BOT_STOP_TEXT}
        confirmLabel="Tout arrêter"
        danger
      />
    </>
  );
}

/** État de Selio Cloud vu du Bot, avec le lien vers les comptes connectés dans le Cloud. */
export function CloudLine({ cloud, className, stacked = false }: { cloud: BotSummary["cloud"]; className?: string; /** Colonne étroite : bouton sous le texte. */ stacked?: boolean }) {
  const status = cloud.ready
    ? { tone: "success" as const, label: "Prêt", text: `${cloud.activeAccounts} compte${cloud.activeAccounts > 1 ? "s" : ""} actif${cloud.activeAccounts > 1 ? "s" : ""} sur ${cloud.accounts} : les bots compatibles tournent ordinateur éteint, de ${cloud.activeHours.startHour} h à ${cloud.activeHours.endHour} h.` }
    : !cloud.available
      ? { tone: "muted" as const, label: "Pas sur ce forfait", text: cloud.reason }
      : cloud.serverEnabled === false
        ? { tone: "warning" as const, label: "Fermé sur ce serveur", text: "Selio Cloud reste fermé tant que l'avis juridique n'est pas rendu : les bots passent par l'extension, ordinateur allumé." }
        : { tone: "warning" as const, label: "Aucun compte actif", text: `${cloud.accounts === 0 ? "Aucun compte Vinted relié au Cloud" : `${cloud.activeAccounts} compte actif sur ${cloud.accounts}`}${cloud.consent ? "" : ", accord à accepter"} : en attendant, les bots passent par l'extension, ordinateur allumé.` };
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

/** Icône d'un bot « bientôt » ou verrouillé, pour les cartes. */
export function BotStateIcon({ state }: { state: BotState }) {
  if (state === "soon") return <Sparkles className="size-4 text-accent" aria-hidden />;
  if (state === "locked") return <Lock className="size-4 text-text-muted" aria-hidden />;
  if (state === "stopped") return <Ban className="size-4 text-danger" aria-hidden />;
  return null;
}
