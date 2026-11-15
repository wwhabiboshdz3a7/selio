import { Link, Navigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { RULE_KIND_LABELS, type BotSummary, type BotView } from "@selio/contracts";
import { RULE_RUN_LOCATION, can } from "@selio/domain";
import { Alert, Card, PageHeader, Toggle, buttonClass, formatDateTime, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { BOT_KEYS, BotPlaceLine, BotRecent, BotStateBadge, CloudLine, StopAllButton, botIdFromSlug, useBotSummary } from "./shared";

/**
 * Selio Bot — page d'un bot : état, où il tourne, limite du forfait, ses règles (allumer ou arrêter, la
 * règle elle-même se règle dans le journal des tâches), liens vers les réglages existants et dernières actions.
 */
export default function BotDetail() {
  const { botId } = useParams();
  const id = botIdFromSlug(botId);
  const q = useBotSummary();
  if (!id) return <Navigate to="/bot" replace />;
  const bot = q.data?.bots.find((b) => b.id === id);
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/bot" className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="size-3.5" aria-hidden />Selio Bot</Link>}
        title={bot?.name ?? "Bot"}
        description={bot?.description}
        actions={q.data ? <StopAllButton summary={q.data} /> : null}
      />
      <QueryBoundary query={q} skeleton="spinner">{(s) => (bot ? <BotBody summary={s} bot={bot} /> : null)}</QueryBoundary>
    </>
  );
}

function BotBody({ summary, bot }: { summary: BotSummary; bot: BotView }) {
  return (
    <>
      {summary.stopped ? <Alert tone="danger" className="mb-4" title="Tout est arrêté">Coupe-circuit actif{summary.stoppedAt ? <> depuis le <span className="num">{formatDateTime(summary.stoppedAt)}</span></> : null} : ce bot n'agit pas jusqu'à la reprise, quels que soient ses réglages.</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-md font-semibold">État</h2>
              <BotStateBadge state={bot.state} />
            </div>
            <p className="text-sm text-text">{bot.stateDetail}</p>
            <BotPlaceLine className="mt-3" place={bot.place} detail={bot.placeDetail} />
            <p className="mt-3 text-sm text-text-muted"><span className="font-medium text-text">Limite du forfait :</span> {bot.planLimit}</p>
          </Card>
          {bot.ruleKinds.length > 0 ? <BotRules bot={bot} /> : null}
          <Card>
            <h2 className="text-md font-semibold">Réglages</h2>
            <p className="mt-1 text-sm text-text-muted">{bot.state === "soon" ? "Vous pouvez déjà préparer le message et la remise : ils serviront dès que le bot sera construit." : "Les réglages restent ceux des automatisations : rien n'est à ressaisir ici."}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {bot.settings.map((l, i) => <li key={l.to}><Link to={l.to} className={buttonClass({ variant: i === 0 ? "secondary" : "ghost", size: "sm" })}>{l.label}</Link></li>)}
            </ul>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {bot.state !== "soon" ? (
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-md font-semibold">Dernières actions</h2>
                <Link to="/app/automations?tab=jobs" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Tout l'historique <ArrowRight className="size-4" aria-hidden /></Link>
              </div>
              <BotRecent actions={bot.recent} empty={bot.state === "on" ? "Rien pour l'instant : le bot agit dès qu'une conversation ou un article remplit ses conditions." : "Aucune action : le bot n'est pas allumé."} />
            </Card>
          ) : null}
          <Card><CloudLine cloud={summary.cloud} stacked /></Card>
        </div>
      </div>
    </>
  );
}

/** Règles regroupées par le bot : on les allume ou on les arrête ici ; horaires et limites se règlent dans le journal des tâches. */
function BotRules({ bot }: { bot: BotView }) {
  const client = useClient();
  const session = useRequiredSession();
  const canWrite = can(session.role, "automations.write");
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => client.listRules() });
  const toggle = useAppMutation(({ id, enabled }: { id: string; enabled: boolean }) => client.updateRule(id, { enabled }), { invalidate: BOT_KEYS, success: (r) => (r.enabled ? `« ${r.name} » allumée` : `« ${r.name} » arrêtée`) });
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Règles du bot</h2>
        <Link to="/app/automations" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">{canWrite ? <><Plus className="size-4" aria-hidden />Créer ou régler</> : "Voir les règles"}</Link>
      </div>
      <p className="mb-3 text-sm text-text-muted">Types : {bot.ruleKinds.map((k) => RULE_KIND_LABELS[k]).join(", ")}. Horaires, limites par jour et validation avant envoi se règlent sur chaque règle.</p>
      <QueryBoundary query={rules} empty={(list) => (list.some((r) => bot.ruleKinds.includes(r.kind)) ? null : <p className="text-sm text-text-muted">Aucune règle de ce type pour l'instant. {canWrite ? "Créez-en une dans le journal des tâches (« Nouvelle règle »)." : ""}</p>)}>
        {(list) => (
          <ul className="flex flex-col divide-y divide-border">
            {list.filter((r) => bot.ruleKinds.includes(r.kind)).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{r.name}</p>
                  <p className="text-xs text-text-muted">{RULE_KIND_LABELS[r.kind]} · {r.requiresApproval ? "validation avant envoi" : "sans validation"} · {r.limits.maxPerDay} par jour · {r.lastRunAt ? `dernier passage ${formatRelative(r.lastRunAt)}` : "jamais exécutée"}</p>
                  <p className="text-xs text-text-muted">{RULE_RUN_LOCATION[r.kind].explanation}</p>
                </div>
                <Toggle label={<span className="sr-only">Allumer {r.name}</span>} checked={r.enabled} onChange={(v) => toggle.mutate({ id: r.id, enabled: v })} disabled={!canWrite || toggle.isPending} />
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Card>
  );
}
