import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { AGENCY_EXAMPLE_CLIENTS } from "@selio/demo-data";
import { ROLE_LABELS } from "@selio/contracts";
import { PageHeader, StatusBadge, Tag, buttonClass, cn, formatCents, formatNumber } from "@selio/ui";
import { seesFinances } from "../../../lib/roles";
import { checklistProgress, loadComptes } from "../../../lib/comptes";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { Sparkline } from "../../../components/charts";
import { ItemThumb } from "../../components/common";
import { BrandMark, initialsOf } from "../components";
import { useNavCounts } from "../../layout";
import { MANAGER_FEATURES, SPACES, spaceStateLabel, type FeatureDef, type FeatureId, type SpaceDef, type SpaceId, type SpaceState } from "../spaces";
import { useAutoBuyStatus } from "../../components/radar";
import { summarizeGenerated, useAllItems, useDressingScores } from "../studio-data";

interface Figure { label: string; value: ReactNode; hint?: string }

const STATE_TONE: Record<SpaceState, "success" | "accent" | "neutral"> = { available: "success", preview: "accent", development: "neutral" };

function SpaceCard({ space, figures, figuresNote, signal, secondary, integrated, rank }: { space: SpaceDef | FeatureDef; figures: Figure[]; figuresNote?: ReactNode; signal?: ReactNode; secondary?: { to: string; label: string }; /** Selio Manager : ses fonctionnalités intégrées (Selio Cloud, Selio Agent). */ integrated?: ReactNode; /** Rang de la filiale dans l'écosystème (1 à 5). */ rank?: number }) {
  const { mode } = useData();
  const available = space.state === "available";
  return (
    <article data-space={space.id} aria-labelledby={`espace-${space.id}`} className="card flex min-w-0 flex-col overflow-hidden">
      <div className="space-rule" aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-5 md:p-6">
        <div className="flex items-start gap-3.5">
          <span className="space-tile size-11" aria-hidden>{space.icon}</span>
          <div className="min-w-0 flex-1">
            {rank ? <p className="num text-[11px] font-medium tracking-wider text-text-muted uppercase">Filiale {rank}</p> : null}
            <h2 id={`espace-${space.id}`} className="text-lg font-bold text-text">{space.name}</h2>
            <p className="text-sm text-text-muted">{space.tagline}</p>
          </div>
          <StatusBadge tone={STATE_TONE[space.state]} className="shrink-0">{spaceStateLabel(space.state, mode)}</StatusBadge>
        </div>
        <p className="text-sm text-text-muted">{space.description}</p>
        {signal ? <div className="min-h-10">{signal}</div> : null}
        {figures.length > 0 ? <div>
          <dl className={cn("grid gap-px overflow-hidden rounded-lg border border-border bg-border", figures.length === 1 ? "grid-cols-1 sm:max-w-[33%]" : figures.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
            {figures.map((f) => (
              <div key={f.label} className="flex min-w-0 flex-col bg-surface px-3 py-2.5">
                {/* Sur mobile, libellés sur deux lignes (jamais tronqués), alignés d'une colonne à l'autre. */}
                <dt className="min-h-[2lh] text-xs leading-snug text-text-muted sm:min-h-0">{f.label}</dt>
                <dd className="num mt-0.5 truncate text-md font-semibold text-text">{f.value}</dd>
                {f.hint ? <dd className="text-[11px] leading-snug text-text-muted">{f.hint}</dd> : null}
              </div>
            ))}
          </dl>
          {figuresNote ? <p className="mt-1.5 text-xs text-text-muted">{figuresNote}</p> : null}
        </div> : null}
        <ul className="flex flex-col gap-1.5 text-sm text-text">
          {space.does.map((d) => (
            <li key={d} className="flex items-start gap-2"><span className="space-dot mt-[7px]" aria-hidden />{d}</li>
          ))}
        </ul>
        {integrated}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Link to={space.home} className={buttonClass({ variant: available ? "primary" : "secondary" })} aria-label={`Ouvrir ${space.name}`}>
            Ouvrir {space.id === "selio" ? space.name : space.short} <ArrowRight aria-hidden />
          </Link>
          {secondary ? <Link to={secondary.to} className={buttonClass({ variant: "ghost" })}>{secondary.label}</Link> : null}
        </div>
      </div>
    </article>
  );
}

const STEPS: readonly { id: SpaceId; step: string; title: string; text: string }[] = [
  { id: "selio", step: "Gérer", title: "Selio Manager, chaque jour", text: "Stock, messagerie, commandes et marges, et les automatisations du compte : négociation par IA, relances, remise en ligne. Selio Cloud et Selio Agent y sont intégrés." },
  { id: "studio", step: "Créer", title: "Selio Studio", text: "Les annonces rédigées et optimisées à partir de vos photos, et de ce qui se vend chez vous." },
  { id: "track", step: "Analyser", title: "Selio Track", text: "Le marché et les opportunités : quelles niches, à quel prix. Track identifie." },
  { id: "bot", step: "Acheter", title: "Selio Bot", text: "Recherches surveillées, bonnes affaires notées sur 100, achat en 1 clic dans vos limites. Bot acquiert." },
  { id: "generateur", step: "Accompagner", title: "Selio Compte", text: "Création et préparation de comptes, configuration et accompagnement, sur devis." },
];

/** Selio Cloud ou Selio Agent, dans le bloc « Intégrés à Selio Manager » de la carte du Manager. */
function IntegratedLine({ feature }: { feature: FeatureDef }) {
  return (
    <li data-space={feature.id} className="flex items-start gap-2.5">
      <span className="space-tile size-7" aria-hidden>{feature.icon}</span>
      <span className="min-w-0 flex-1 text-sm">
        <Link to={feature.home} className="font-semibold text-text underline-offset-2 hover:underline">{feature.name}</Link>
        <span className="block text-xs text-text-muted">{feature.tagline}</span>
      </span>
    </li>
  );
}

export default function Hub() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const overview = useQuery({ queryKey: ["overview", "month"], queryFn: () => client.getOverview("month") });
  const counts = useNavCounts();
  const items = useAllItems();
  const scores = useDressingScores();
  const whiteLabel = useQuery({ queryKey: ["white-label"], queryFn: () => client.getWhiteLabel() });
  const members = useQuery({ queryKey: ["members"], queryFn: () => client.listMembers() });
  const cloudAccounts = useQuery({ queryKey: ["cloud-accounts"], queryFn: () => client.cloudAccounts() });
  const cloudConsent = useQuery({ queryKey: ["cloud-consent"], queryFn: () => client.cloudConsent() });
  const cloudAvailability = useQuery({ queryKey: ["cloud-availability"], queryFn: () => client.cloudAvailability() });
  const searches = useQuery({ queryKey: ["searches"], queryFn: () => client.listSearches() });
  const autoBuy = useAutoBuyStatus();
  const cloudLive = (cloudAccounts.data ?? []).filter((a) => a.status !== "stopped");
  const studio = items.data ? summarizeGenerated(items.data.items, scores.data) : null;
  const first = session.user.displayName.split(" ")[0];
  const dash = "—";
  // Exécuteur : pas de chiffre d'affaires (finances masquées) ; le nombre de ventes à la place.
  const finances = seesFinances(session.role);
  const comptes = checklistProgress(new Set(loadComptes(session.org.id).done));
  const figures: Partial<Record<SpaceId | FeatureId, Figure[]>> = {
    selio: [
      finances
        ? { label: "CA du mois", value: overview.data ? formatCents(overview.data.sales.revenueCents, { compact: true }) : dash }
        : { label: "Ventes du mois", value: overview.data ? formatNumber(overview.data.sales.orderCount) : dash },
      { label: "Annonces en ligne", value: overview.data ? formatNumber(overview.data.stock.listedCount) : dash, hint: counts.data ? `${counts.data.dressingDue} à republier` : undefined },
      { label: "Messages non lus", value: counts.data ? formatNumber(counts.data.unread) : dash },
    ],
    studio: [
      { label: "Annonces générées", value: studio ? formatNumber(studio.generated.length) : dash },
      { label: "En ligne", value: studio ? formatNumber(studio.online) : dash, hint: studio ? `${studio.sold} vendue(s)` : undefined },
      { label: "Note moyenne", value: studio?.averageScore != null ? `${studio.averageScore}/100` : dash, hint: studio?.othersAverageScore != null ? `autres annonces : ${studio.othersAverageScore}` : undefined },
    ],
    agents: [
      { label: "Membres", value: members.data ? formatNumber(members.data.length) : dash },
      { label: "Votre rôle", value: ROLE_LABELS[session.role] },
      { label: "Boutiques clientes", value: formatNumber(AGENCY_EXAMPLE_CLIENTS.length), hint: "exemples fictifs" },
    ],
    bot: [
      { label: "Recherches actives", value: searches.data ? formatNumber(searches.data.filter((x) => x.enabled).length) : dash },
      { label: "Affaires à valider", value: counts.data ? formatNumber(counts.data.toReview) : dash, hint: "notées 75/100 ou plus" },
      { label: "Achat automatique", value: autoBuy.data ? (autoBuy.data.active ? "Ouvert" : "Fermé") : dash, hint: autoBuy.data?.active ? undefined : "validation juridique attendue" },
    ],
    generateur: [
      { label: "Checklist", value: `${comptes.done}/${comptes.total}`, hint: "étapes faites dans Vinted" },
    ],
    cloud: [
      { label: "Comptes Cloud", value: cloudAccounts.data ? formatNumber(cloudLive.length) : dash, hint: "10 au plus" },
      { label: "En pause", value: cloudAccounts.data ? formatNumber(cloudLive.filter((a) => a.status === "paused").length) : dash },
      { label: "Actions aujourd'hui", value: cloudAccounts.data ? formatNumber(cloudLive.reduce((n, a) => n + a.actionsToday, 0)) : dash },
    ],
  };

  // Chiffre d'affaires cumulé jour après jour : la courbe monte à chaque vente du mois.
  const cumulative = (overview.data?.series ?? []).reduce<number[]>((acc, p) => [...acc, (acc.at(-1) ?? 0) + p.revenueCents], []);
  const recent = studio?.generated.slice(0, 5) ?? [];
  const brand = whiteLabel.data;
  const signals: Partial<Record<SpaceId | FeatureId, ReactNode>> = {
    selio: finances && (cumulative.at(-1) ?? 0) > 0 ? (
      <div className="flex items-center gap-3">
        <Sparkline values={cumulative} className="h-10 w-full max-w-56" tone="var(--space-tint)" />
        <p className="text-xs text-text-muted">Chiffre d'affaires cumulé, {overview.data!.periodLabel}</p>
      </div>
    ) : <p className="text-xs text-text-muted">Aucune vente ce mois-ci pour l'instant.</p>,
    studio: recent.length > 0 ? (
      <div className="flex items-center gap-3">
        <ul className="flex shrink-0 -space-x-2" aria-label="Dernières annonces générées">
          {recent.map((it) => <li key={it.id} className="rounded-md ring-2 ring-surface"><ItemThumb photos={it.photos} title={it.title} size={36} /></li>)}
        </ul>
        <p className="min-w-0 text-xs text-text-muted"><span className="block truncate text-text">Dernière : {recent[0]!.title}</span>{studio?.drafts ? `${studio.drafts} brouillon(s) à relire` : "Aucun brouillon en attente"}</p>
      </div>
    ) : <p className="text-xs text-text-muted">Aucune annonce générée pour l'instant : ajoutez les photos d'un article pour commencer.</p>,
    cloud: (
      <p className="text-xs text-text-muted">
        <span className="block text-text">{cloudAvailability.data ? (cloudAvailability.data.included ? "Compris dans votre offre" : cloudAvailability.data.optional ? "En option avec Pro, prix à décider" : "Disponible à partir de Pro") : dash}</span>
        {cloudConsent.data ? (cloudConsent.data.current ? "Accord enregistré" : "Accord à donner avant toute action") : null}
      </p>
    ),
    agents: (
      <div className="flex items-center gap-3">
        <BrandMark initials={brand?.initials ?? initialsOf(session.org.name)} accent={brand?.accent} size={36} />
        <p className="min-w-0 text-xs text-text-muted">
          <span className="block truncate text-text">{session.org.name}</span>
          L'administrateur, l'équipe et les accès de votre organisation
        </p>
      </div>
    ),
  };

  const secondaryOf: Partial<Record<SpaceId | FeatureId, { to: string; label: string }>> = {
    selio: { to: "/app/automatisation", label: "Automatisation" },
    studio: { to: "/studio/performances", label: "Ce qui performe" },
    bot: { to: "/app/purchase", label: "Affaires à valider" },
    generateur: { to: "/contact?sujet=compte", label: "Demander un devis" },
    cloud: { to: "/cloud/journal", label: "Journal des actions" },
    agents: { to: "/app/settings/access", label: "Comptes et accès" },
  };
  const notes: Partial<Record<SpaceId | FeatureId, ReactNode>> = {
    selio: "Calculés depuis vos données, ce mois-ci.",
    studio: "Note du dressing des annonces en ligne.",
    bot: mode === "demo" ? "Démonstration : annonces du simulateur, aucun achat réel." : "Vous validez chaque achat ; l'achat automatique reste fermé.",
    cloud: mode === "demo" ? <><Tag className="mr-1.5">Aperçu</Tag>Actions légères seulement (répondre, relancer).</> : "Actions légères seulement (répondre, relancer), avec votre accord.",
    agents: mode === "demo" ? <><Tag className="mr-1.5">Aperçu</Tag>Boutiques clientes fictives, rien n'est facturé.</> : "L'équipe et les rôles sont actifs ; les boutiques clientes arrivent.",
  };

  return (
    <>
      <PageHeader
        eyebrow={`Bonjour ${first}`}
        title="Selio et ses filiales"
        description="Un compte, une IA, cinq filiales : Selio Manager gère et automatise votre activité au quotidien ; Studio, Track, Bot et Compte s'appuient sur ses données, sans rien ressaisir. Pour passer de l'une à l'autre, utilisez le bloc « Vous êtes dans » en haut du menu."
      />

      <h2 className="mb-3 text-sm font-bold tracking-wider text-text uppercase">Les cinq filiales</h2>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {SPACES.map((space, i) => (
          <SpaceCard
            key={space.id}
            rank={i + 1}
            space={space}
            figures={figures[space.id] ?? []}
            signal={signals[space.id]}
            figuresNote={notes[space.id]}
            secondary={secondaryOf[space.id]}
            integrated={space.id === "selio" ? (
              <div className="rounded-lg border border-dashed border-border-strong p-3" aria-label="Intégrés à Selio Manager" role="group">
                <p className="mb-2 text-xs font-bold tracking-wider text-text-muted uppercase">Intégrés à Selio Manager</p>
                <ul className="flex flex-col gap-2">{MANAGER_FEATURES.map((f) => <IntegratedLine key={f.id} feature={f} />)}</ul>
              </div>
            ) : null}
          />
        ))}
      </div>

      <section aria-labelledby="integres" className="mt-8">
        <h2 id="integres" className="mb-1 text-sm font-bold tracking-wider text-text uppercase">Intégrés à Selio Manager</h2>
        <p className="mb-3 max-w-3xl text-sm text-text-muted">Selio Cloud et Selio Agent ne sont pas des filiales : ce sont deux fonctionnalités de Selio Manager, avec leurs pages dans son menu (« Équipe et Cloud »).</p>
        <div className="grid gap-4 lg:grid-cols-2">
          {MANAGER_FEATURES.map((f) => (
            <SpaceCard key={f.id} space={f} figures={figures[f.id] ?? []} signal={signals[f.id]} figuresNote={notes[f.id]} secondary={secondaryOf[f.id]} />
          ))}
        </div>
      </section>

      <section aria-labelledby="enchainement" className="card mt-8 p-5 md:p-6">
        <h2 id="enchainement" className="text-md font-bold text-text">Comment les filiales s'enchaînent</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">D'abord l'outil de gestion, ensuite les filiales spécialisées : rien n'est à ressaisir de l'une à l'autre. Track analyse et identifie, Bot acquiert.</p>
        <ol className="mt-5 grid gap-5 md:grid-cols-2 md:gap-6 xl:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.id} data-space={s.id} className="relative flex gap-3 md:flex-col">
              <span className="flex items-center gap-2 md:w-full">
                <span className="num inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--space-tint-soft)] text-xs font-semibold text-[var(--space-tint-ink)]" aria-hidden>{i + 1}</span>
                <span className={cn("hidden h-px flex-1 bg-border md:block", i === STEPS.length - 1 && "md:invisible")} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{s.step}</p>
                <h3 className="mt-0.5 text-base font-semibold text-text">{s.title}</h3>
                <p className="mt-1 text-sm text-text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-border pt-4 text-xs text-text-muted">{mode === "demo" ? "Les filiales en aperçu ou en développement ne sont pas facturées à part ;" : "Les filiales en cours d'activation ne sont pas facturées à part ;"} Selio Cloud ne s'active qu'avec votre accord, compte par compte. Vos données restent celles de votre organisation : elles alimentent vos propres analyses. Selio est un outil indépendant, ni affilié à Vinted ni approuvé par Vinted.</p>
      </section>
    </>
  );
}
