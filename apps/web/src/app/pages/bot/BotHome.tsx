import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bell, Bot, History, Images, Search, ShieldCheck, Wallet } from "lucide-react";
import type { Opportunity, PurchaseRequest } from "@selio/contracts";
import { REVIEW_THRESHOLD, dealEconomics } from "@selio/domain";
import { Card, EmptyState, PageHeader, StatStrip, Tag, buttonClass, cn, formatCents, formatNumber, formatRelative } from "@selio/ui";
import { ScoreRing } from "../../../components/charts";
import { useFeature } from "../../../lib/capabilities";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { BandBadge } from "../../components/deals";
import { PurchaseStatusBadge, SourceTag, useAutoBuyStatus } from "../../components/radar";
import { useAutomationSummary } from "../automation/status";
import { PurchaseModes } from "./shared";

/**
 * Selio Bot, quatrième filiale de Selio : la recherche et l'achat d'articles. Recherches actives
 * (automatisées selon vos critères, surveillées), bonnes affaires notées sur 100 avec la revente estimée et
 * la marge potentielle, alertes, limites de dépenses, historique des achats, et les deux modes d'achat :
 * l'achat rapide validé en 1 clic (achat assisté) et l'achat automatique (fermé par ses deux verrous du
 * serveur tant que la validation juridique manque). Track analyse et identifie ; Bot acquiert. Les
 * automatisations du compte (négociation, relances…) sont dans Selio Manager › Automatisation.
 */
export default function BotHome() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const summary = useAutomationSummary();
  const auto = useAutoBuyStatus();
  const searches = useQuery({ queryKey: ["searches"], queryFn: () => client.listSearches() });
  // Mode connecté sans lecture en direct : jamais d'affaire du simulateur à l'écran (comme la page des affaires).
  const radarLive = useFeature("radarLive");
  const hideSimulated = mode === "connected" && !radarLive.live;
  const deals = useQuery({ queryKey: ["opportunities", "bot-home", hideSimulated], queryFn: async () => {
    const all = await client.listOpportunities({});
    return all
      .filter((o) => o.score >= REVIEW_THRESHOLD && o.status !== "dismissed" && o.status !== "purchased" && !(hideSimulated && o.observed.source === "demo_simulator"))
      .sort((a, b) => b.score - a.score);
  } });
  const purchases = useQuery({ queryKey: ["purchases"], queryFn: () => client.listPurchaseRequests() });
  const fees = session.org.settings.buyerFees;
  const limits = session.org.settings.autoBuy;
  const alerts = session.org.settings.radar ?? { alertsEnabled: true, alertMinScore: REVIEW_THRESHOLD, quietHours: null };
  const today = new Date().toISOString().slice(0, 10);
  const spentToday = (purchases.data ?? []).filter((p) => (p.status === "simulated" || p.status === "executed") && (p.executedAt ?? "").slice(0, 10) === today).reduce((s, p) => s + (p.totalCents ?? p.maxPriceCents), 0);
  const active = (searches.data ?? []).filter((s) => s.enabled);
  const toReview = (deals.data ?? []).filter((o) => o.status === "new").length;

  return (
    <>
      <PageHeader
        eyebrow="Selio Bot"
        title="Selio Bot : recherche et achat d'articles"
        description="Vos recherches tournent selon vos critères et surveillent les nouvelles annonces ; chaque bonne affaire est notée sur 100, avec la revente estimée et la marge potentielle. Vous achetez en 1 clic, dans vos limites de dépenses. Selio Track analyse le marché ; Selio Bot achète."
        actions={<>
          <Link to="/app/radar" className={buttonClass({ variant: "primary" })}><Search aria-hidden />Recherches et affaires</Link>
          <Link to="/app/purchase" className={buttonClass({ variant: "secondary" })}>À valider{toReview ? ` (${toReview})` : ""}</Link>
        </>}
      />
      {mode === "demo" ? <p className="mb-4 text-xs text-text-muted">Démonstration : les annonces viennent d'un simulateur (aucune page Vinted lue) et aucun achat n'est réel.</p> : null}

      <StatStrip
        className="mb-6 grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Recherches actives", value: searches.data ? <>{formatNumber(active.length)}<span className="text-base font-medium text-text-muted"> / {searches.data.length}</span></> : "—", sub: "surveillées selon vos critères" },
          { label: "Bonnes affaires", value: deals.data ? formatNumber(deals.data.length) : "—", sub: `notées ${REVIEW_THRESHOLD}/100 ou plus, dont ${formatNumber(toReview)} à valider` },
          { label: "Dépensé aujourd'hui", value: formatCents(spentToday), sub: `limite ${formatCents(limits.dailyCapCents)} par jour` },
          { label: "Achat automatique", value: auto.data ? (auto.data.active ? "Ouvert" : "Fermé") : "—", sub: auto.data?.active ? "tous les verrous sont levés" : "validation juridique attendue" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section icon={<Bot />} title="Bonnes affaires notées sur 100" link={{ to: "/app/radar", label: "Toutes les affaires" }}>
          <QueryBoundary query={deals} skeleton="spinner" empty={(d) => d.length === 0 ? <EmptyState title="Aucune bonne affaire pour l'instant" description="Selio Bot vous alerte dès qu'une annonce dépasse 75/100 sur une de vos recherches." /> : null}>
            {(list) => (
              <ul className="flex flex-col divide-y divide-border" aria-label="Meilleures affaires">
                {list.slice(0, 5).map((o) => <DealRow key={o.id} o={o} fees={fees} />)}
              </ul>
            )}
          </QueryBoundary>
        </Section>

        <Section icon={<Search />} title="Recherches actives" link={{ to: "/app/radar", label: "Gérer les recherches" }}>
          <QueryBoundary query={searches} skeleton="spinner" empty={(d) => d.length === 0 ? <EmptyState title="Aucune recherche" description="Créez une recherche : marques, tailles, prix maximal et marge cible." action={<Link to="/app/radar" className={buttonClass({ variant: "secondary", size: "sm" })}>Créer une recherche</Link>} /> : null}>
            {(list) => (
              <ul className="flex flex-col divide-y divide-border" aria-label="Recherches">
                {list.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-text">{s.name}{!s.enabled ? <Tag>En pause</Tag> : null}</p>
                      <p className="text-xs text-text-muted">Prix max {formatCents(s.criteria.maxPriceCents)} · budget {formatCents(s.budgetCents)} · {s.lastReadAt ?? s.lastRunAt ? `lue ${formatRelative((s.lastReadAt ?? s.lastRunAt)!)}` : "jamais lue"}</p>
                    </div>
                    <SourceTag search={s} />
                  </li>
                ))}
              </ul>
            )}
          </QueryBoundary>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Section icon={<Bell />} title="Alertes" link={{ to: "/app/settings/notifications", label: "Régler les alertes" }}>
          <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
            <li><span className="font-medium text-text">{alerts.alertsEnabled ? "Activées" : "Coupées"}</span> : une notification sur votre téléphone dès qu'une affaire atteint {alerts.alertMinScore}/100.</li>
            <li>{alerts.quietHours ? <>Heures calmes de <span className="num">{alerts.quietHours.from}</span> h à <span className="num">{alerts.quietHours.to}</span> h : les alertes partent à la fin de la plage.</> : "Aucune heure calme : les alertes partent tout de suite."}</li>
            <li>Jamais de pseudo, de note ni de photo du vendeur dans une notification.</li>
          </ul>
        </Section>
        <Section icon={<Wallet />} title="Limites de dépenses" link={{ to: "/bot/achat-auto", label: "Réglages" }}>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Limit label="Budget par jour" value={formatCents(limits.dailyCapCents)} />
            <Limit label="Max par achat" value={formatCents(limits.maxItemCents)} />
            <Limit label="Dépensé aujourd'hui" value={formatCents(spentToday)} />
          </dl>
          <p className="mt-2 text-xs text-text-muted">Port et protection acheteurs compris. Chaque recherche a aussi son budget ; un achat qui dépasse une limite est bloqué par les contrôles, même validé à la main.</p>
        </Section>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wider text-text uppercase">Les deux modes d'achat</h2>
      <QueryBoundary query={summary} skeleton="spinner">{(s) => <PurchaseModes summary={s} />}</QueryBoundary>

      <Section className="mt-6" icon={<History />} title="Historique des achats" link={{ to: "/app/purchase", label: "Tout l'historique" }}>
        <QueryBoundary query={purchases} skeleton="spinner" empty={(d) => d.length === 0 ? <p className="text-sm text-text-muted">Aucun achat pour l'instant : les achats validés en 1 clic et les achats automatiques apparaîtront ici.</p> : null}>
          {(list) => (
            <ul className="flex flex-col divide-y divide-border" aria-label="Derniers achats">
              {list.slice(0, 5).map((p) => <PurchaseRow key={p.id} p={p} />)}
            </ul>
          )}
        </QueryBoundary>
      </Section>

      <Card className="mt-6">
        <div className="mb-2 flex items-center gap-2"><ShieldCheck className="size-4 text-text-muted" aria-hidden /><h2 className="text-md font-semibold">Ce que Selio Bot ne fait jamais</h2></div>
        <ul className="grid gap-1.5 text-sm text-text-muted md:grid-cols-2">
          <li>Contourner un CAPTCHA ou une protection de Vinted : au premier signal, la lecture s'arrête et le compte Achat se met en pause.</li>
          <li>Garder votre mot de passe Vinted : vous vous connectez vous-même dans la fenêtre sécurisée de Selio Cloud.</li>
          <li>Acheter hors de vos limites : budget par jour, prix maximal par achat, budget de chaque recherche.</li>
          <li>Acheter sans verrous : l'achat automatique reste fermé tant que la validation juridique n'est pas rendue.</li>
        </ul>
        <p className="mt-3 text-xs text-text-muted">Les automatisations de votre compte (négociation par IA, relances, remise en ligne, réponses) sont dans <Link to="/app/automatisation" className="font-medium text-accent underline-offset-2 hover:underline">Selio Manager › Automatisation</Link>.</p>
      </Card>
    </>
  );
}

function Section({ icon, title, link, children, className }: { icon: ReactNode; title: string; link?: { to: string; label: string }; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-md font-semibold text-text [&>svg]:size-4 [&>svg]:text-accent">{icon}{title}</h2>
        {link ? <Link to={link.to} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">{link.label} <ArrowRight className="size-4" aria-hidden /></Link> : null}
      </div>
      {children}
    </Card>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-surface-muted px-3 py-2"><dt className="text-xs text-text-muted">{label}</dt><dd className="num font-semibold text-text">{value}</dd></div>;
}

/** Une bonne affaire : note, prix total, revente estimée et marge potentielle. */
function DealRow({ o, fees }: { o: Opportunity; fees: Parameters<typeof dealEconomics>[2] }) {
  const d = dealEconomics(o.observed, o.estimate.resalePriceCents, fees, o.estimate.expectedFeesCents);
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0" data-deal={o.id}>
      <ScoreRing score={o.score} size={40} stroke={4} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text"><Link to={`/app/radar/affaires/${o.id}`} className="hover:underline underline-offset-2">{o.title}</Link></p>
        <p className="text-xs text-text-muted">
          Achat <span className="num text-text">{formatCents(d.totalCents)}</span> · revente estimée <span className="num text-text">{formatCents(d.resaleCents)}</span> · marge potentielle <span className={cn("num font-semibold", d.profitCents > 0 ? "text-success" : "text-danger")}>{d.profitCents > 0 ? "+" : ""}{formatCents(d.profitCents)}</span> <span className="num">({Math.round(d.marginRate * 100)} %)</span>
        </p>
      </div>
      <BandBadge score={o.score} className="hidden shrink-0 sm:inline-flex" />
    </li>
  );
}

function PurchaseRow({ p }: { p: PurchaseRequest & { opportunity: Opportunity | null } }) {
  const o = p.opportunity;
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      {o?.observed.photoUrl ? <img src={o.observed.photoUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-text-subtle"><Images className="size-4" aria-hidden /></span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{o?.title ?? "Affaire supprimée"}</p>
        <p className="text-xs text-text-muted">{p.mode === "auto" ? "Achat automatique" : "Achat rapide (1 clic)"} · <span className="num">{formatCents(p.totalCents ?? p.maxPriceCents)}</span> · <span className="num">{formatRelative(p.createdAt)}</span></p>
      </div>
      <PurchaseStatusBadge status={p.status} />
    </li>
  );
}
