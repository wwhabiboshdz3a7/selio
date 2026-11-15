import { Link } from "react-router";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { PLAN_LABELS, isPlan, type BotView } from "@selio/contracts";
import { Alert, Card, PageHeader, StatStrip, formatDateTime, formatNumber } from "@selio/ui";
import { QueryBoundary } from "../../components/common";
import { BotPlaceLine, BotRecent, BotStateBadge, BotStateIcon, CloudLine, StopAllButton, botPath, useBotSummary } from "./shared";

/**
 * Selio Bot — tableau des bots : chaque automatisation qui agit pour vous, son état, où elle tourne
 * (Selio Cloud, extension ou serveur), la limite du forfait et ses dernières actions, plus « Tout arrêter »
 * (coupe-circuit de l'organisation). Les réglages restent ceux des automatisations existantes.
 */
export default function BotHome() {
  const q = useBotSummary();
  return (
    <>
      <PageHeader
        eyebrow="Selio Bot"
        title="Vos bots"
        description="Les automatisations qui agissent pour vous : elles négocient, relancent, répondent, republient et achètent selon vos règles et vos plafonds. Elles tournent dans Selio Cloud, ordinateur éteint, ou à défaut par l'extension, ordinateur allumé."
        actions={q.data ? <StopAllButton summary={q.data} /> : null}
      />
      <QueryBoundary query={q} skeleton="spinner">
        {(s) => {
          const on = s.bots.filter((b) => b.state === "on").length;
          const planLabel = isPlan(s.plan) ? PLAN_LABELS[s.plan] : s.plan;
          return (
            <>
              {s.stopped ? (
                <Alert tone="danger" className="mb-4" title="Tout est arrêté">
                  Coupe-circuit actif{s.stoppedAt ? <> depuis le <span className="num">{formatDateTime(s.stoppedAt)}</span></> : null} : aucun bot n'agit, ni dans Selio Cloud ni sur le serveur. Les tâches en file attendent la reprise.{s.canManage ? "" : " Seuls le titulaire et les administrateurs peuvent reprendre."}
                </Alert>
              ) : null}
              {s.simulated ? <Alert tone="info" className="mb-4" title="Démonstration">Rien n'est envoyé ni acheté : les bots montrent ce qu'ils feraient, avec vos règles.</Alert> : null}
              {!s.canManage ? <p className="mb-4 text-sm text-text-muted">Consultation : seuls le titulaire et les administrateurs peuvent tout arrêter ou reprendre.</p> : null}

              <StatStrip
                className="mb-4 grid-cols-2 lg:grid-cols-3"
                items={[
                  { label: "Bots allumés", value: <>{formatNumber(on)}<span className="text-base font-medium text-text-muted"> / {s.bots.length}</span></>, sub: s.stopped ? "coupés par « Tout arrêter »" : "les autres sont arrêtés, en attente ou bientôt là" },
                  { label: "Actions aujourd'hui", value: formatNumber(s.actionsToday), sub: `plafond de l'offre ${planLabel} : ${formatNumber(s.actionsPerDay)} par jour` },
                  { label: "Achat automatique", value: s.autoBuy.active ? "Ouvert" : "Fermé", sub: s.autoBuy.serverEnabled ? (s.autoBuy.realPurchase ? "achat réel ouvert" : "essai à blanc : arrêt avant le paiement") : "verrous du serveur fermés" },
                ]}
              />

              <Card className="mb-6"><CloudLine cloud={s.cloud} /></Card>

              <h2 className="mb-3 text-sm font-bold tracking-wider text-text uppercase">Les bots</h2>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Bots">
                {s.bots.map((b) => <BotCard key={b.id} bot={b} />)}
              </ul>

              <Card className="mt-6">
                <div className="mb-2 flex items-center gap-2"><ShieldCheck className="size-4 text-text-muted" aria-hidden /><h2 className="text-md font-semibold">Ce qu'aucun bot ne fait</h2></div>
                <ul className="grid gap-1.5 text-sm text-text-muted md:grid-cols-2">
                  <li>Contourner un CAPTCHA ou une protection de Vinted : au premier signal, le compte se met en pause et rien n'est retenté.</li>
                  <li>Garder votre mot de passe Vinted : vous vous connectez vous-même dans la fenêtre sécurisée du Cloud.</li>
                  <li>Agir hors de vos plafonds : limites par jour et par acheteur, heures actives, rythme humain.</li>
                  <li>Acheter sans verrous : l'achat automatique reste fermé tant que la validation juridique n'est pas rendue.</li>
                </ul>
                <p className="mt-3 text-xs text-text-muted">Tout est journalisé : <Link to="/app/automations?tab=jobs" className="font-medium text-accent underline-offset-2 hover:underline">file et historique des tâches</Link>, <Link to="/cloud/journal" className="font-medium text-accent underline-offset-2 hover:underline">journal de Selio Cloud</Link>.</p>
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}

function BotCard({ bot }: { bot: BotView }) {
  const to = botPath(bot.id);
  return (
    <li className="card flex min-w-0 flex-col gap-3 p-5" data-bot={bot.id}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-bold text-text"><Link to={to} className="hover:underline underline-offset-2">{bot.name}</Link><BotStateIcon state={bot.state} /></h3>
        <BotStateBadge state={bot.state} />
      </div>
      <p className="text-sm text-text-muted">{bot.description}</p>
      <p className="text-sm text-text">{bot.stateDetail}</p>
      <BotPlaceLine place={bot.place} detail={bot.placeDetail} />
      <p className="text-xs text-text-muted"><span className="font-medium text-text">Forfait :</span> {bot.planLimit}</p>
      {bot.state !== "soon" ? (
        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">Dernières actions</p>
          <BotRecent actions={bot.recent} max={3} />
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-text-muted">{bot.rulesTotal > 0 ? `${bot.rulesEnabled} règle${bot.rulesEnabled > 1 ? "s" : ""} active${bot.rulesEnabled > 1 ? "s" : ""} sur ${bot.rulesTotal}` : bot.id === "auto_buy" ? "Radar Auto et achat assisté" : "Réglages seulement"}</span>
        <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-accent">Régler et surveiller <ArrowRight className="size-4" aria-hidden /></Link>
      </div>
    </li>
  );
}
