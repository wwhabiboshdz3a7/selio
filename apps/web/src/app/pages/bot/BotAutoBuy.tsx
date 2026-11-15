import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Hand, Lock, LockOpen } from "lucide-react";
import type { BotSummary } from "@selio/contracts";
import { REVIEW_THRESHOLD } from "@selio/domain";
import { Alert, Card, PageHeader, StatusBadge, buttonClass, cn, formatCents } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAutoBuyStatus } from "../../components/radar";
import { AutoBuyBody } from "../AutoBuy";
import { BotStateBadge, CloudLine, StopAllButton, useBotSummary } from "./shared";

/**
 * Selio Bot — « Achat auto » : les deux façons d'acheter, côte à côte. L'achat assisté (vous validez chaque
 * affaire en 1 clic) est toujours là ; l'achat automatique (Radar Auto) reste derrière ses deux verrous du
 * serveur, visibles et expliqués, puis ceux de l'organisation (réglage, compte Achat dans le Cloud, accord).
 * Les réglages (note minimale, budget par jour, prix maximum) sont ceux de Radar Auto, repris tels quels.
 */
export default function BotAutoBuy() {
  const summary = useBotSummary();
  const status = useAutoBuyStatus();
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/bot" className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="size-3.5" aria-hidden />Selio Bot</Link>}
        title="Achat auto"
        description="Soit le bot achète seul, au-dessus d'une note minimale et dans un budget par jour (Radar Auto) ; soit il vous propose chaque bonne affaire et vous validez en 1 clic (achat assisté)."
        actions={summary.data ? <StopAllButton summary={summary.data} /> : null}
      />
      <QueryBoundary query={summary} skeleton="spinner">{(s) => <Modes summary={s} />}</QueryBoundary>
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wider text-text uppercase">Radar Auto : verrous, réglages et achats</h2>
      <QueryBoundary query={status} skeleton="spinner">{(st) => <AutoBuyBody status={st} />}</QueryBoundary>
    </>
  );
}

function Modes({ summary }: { summary: BotSummary }) {
  const client = useClient();
  const toReview = useQuery({ queryKey: ["opportunities", "to-review"], queryFn: async () => (await client.listOpportunities({ status: "new" })).filter((o) => o.score >= REVIEW_THRESHOLD) });
  const a = summary.autoBuy;
  const bot = summary.bots.find((b) => b.id === "auto_buy");
  const count = toReview.data?.length ?? null;
  return (
    <>
      {summary.stopped ? <Alert tone="danger" className="mb-4" title="Tout est arrêté">L'achat automatique est coupé. L'achat assisté reste disponible : vous validez chaque achat vous-même.</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3" data-testid="mode-assisted">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 text-md font-semibold"><Hand className="size-4 text-accent" aria-hidden />Achat assisté</h2>
            <StatusBadge tone="success">Disponible</StatusBadge>
          </div>
          <p className="text-sm text-text-muted">Le radar note chaque annonce sur 100. Dès {REVIEW_THRESHOLD}/100, l'affaire arrive dans « À valider » avec le calcul achat → revente → bénéfice : <span className="font-medium text-text">vous validez chaque achat</span> en 1 clic, ou vous l'écartez.</p>
          <p className="text-sm text-text">{count === null ? "…" : count === 0 ? "Aucune affaire à valider pour l'instant." : `${count} affaire${count > 1 ? "s" : ""} à valider.`}</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Link to="/app/purchase" className={buttonClass({ variant: "secondary", size: "sm" })}>Affaires à valider</Link>
            <Link to="/app/radar" className={buttonClass({ variant: "ghost", size: "sm" })}>Bonnes affaires</Link>
          </div>
        </Card>
        <Card className="flex flex-col gap-3" data-testid="mode-auto">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 text-md font-semibold"><Bot className="size-4 text-accent" aria-hidden />Achat automatique (Radar Auto)</h2>
            {bot ? <BotStateBadge state={bot.state} /> : null}
          </div>
          <p className="text-sm text-text-muted">{bot?.stateDetail}</p>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md bg-surface-muted px-3 py-2"><dt className="text-xs text-text-muted">Note minimale</dt><dd className="num font-semibold text-text">{a.threshold}/100</dd></div>
            <div className="rounded-md bg-surface-muted px-3 py-2"><dt className="text-xs text-text-muted">Budget max / jour</dt><dd className="num font-semibold text-text">{formatCents(a.dailyCapCents)}</dd></div>
            <div className="rounded-md bg-surface-muted px-3 py-2"><dt className="text-xs text-text-muted">Max par article</dt><dd className="num font-semibold text-text">{formatCents(a.maxItemCents)}</dd></div>
          </dl>
          <p className="text-xs text-text-muted">Réglables plus bas, par le titulaire, quand le verrou du serveur est ouvert. Paiement par le porte-monnaie Vinted ; une validation 3-D Secure vous attend toujours.</p>
        </Card>
      </div>

      <Card className="mt-4" aria-labelledby="server-locks">
        <h2 id="server-locks" className="text-md font-semibold">Les deux verrous du serveur</h2>
        <p className="mt-1 mb-3 text-sm text-text-muted">Fermés par défaut. Seule l'équipe Selio peut les ouvrir, sur ses propres comptes de test, en attendant l'avis juridique ; aucun réglage de l'application ne les contourne.</p>
        <ul className="grid gap-3 md:grid-cols-2">
          <ServerLock ok={a.serverEnabled} name="1. Achat automatique (RADAR_AUTO_ENABLED)" text={a.serverEnabled ? "Ouvert pour les comptes de l'équipe : Radar Auto peut choisir et lancer un achat, si vos propres verrous sont levés." : "Fermé : Radar Auto n'évalue rien et n'ouvre aucun navigateur. Réservé aux comptes de l'équipe sur l'adresse partagée."} />
          <ServerLock ok={a.realPurchase} name="2. Achat réel (RADAR_REAL_PURCHASE)" text={a.realPurchase ? "Ouvert : le bouton « Payer » peut être cliqué." : "Fermé : même verrou 1 ouvert, le parcours s'arrête avant le bouton de paiement ; l'achat est enregistré « simulé », sans paiement ni commande."} />
        </ul>
      </Card>
      <Card className="mt-4"><CloudLine cloud={summary.cloud} /></Card>
    </>
  );
}

function ServerLock({ ok, name, text }: { ok: boolean; name: string; text: string }) {
  return (
    <li className={cn("flex items-start gap-3 rounded-md border px-3 py-2.5", ok ? "border-success/40" : "border-border")} data-server-lock={ok ? "open" : "closed"}>
      {ok ? <LockOpen className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Lock className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{name}<StatusBadge tone={ok ? "success" : "muted"}>{ok ? "Ouvert" : "Fermé"}</StatusBadge></p>
        <p className="mt-0.5 text-xs text-text-muted">{text}</p>
      </div>
    </li>
  );
}
