import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { AGENCY_EXAMPLE_CLIENTS } from "@selio/demo-data";
import { ROLE_LABELS } from "@selio/contracts";
import { PageHeader, StatusBadge, Tag, buttonClass, cn, formatCents, formatNumber } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { Sparkline } from "../../../components/charts";
import { ItemThumb } from "../../components/common";
import { BrandMark, initialsOf } from "../components";
import { useNavCounts } from "../../layout";
import { SPACES, SPACE_STATE_LABEL, type SpaceDef, type SpaceState } from "../spaces";
import { summarizeGenerated, useAllItems, useDressingScores } from "../studio-data";

interface Figure { label: string; value: ReactNode; hint?: string }

const STATE_TONE: Record<SpaceState, "success" | "accent" | "neutral"> = { available: "success", preview: "accent", development: "neutral" };

function SpaceCard({ space, figures, figuresNote, signal, secondary }: { space: SpaceDef; figures: Figure[]; figuresNote?: ReactNode; signal?: ReactNode; secondary?: { to: string; label: string } }) {
  const available = space.state === "available";
  return (
    <article data-space={space.id} aria-labelledby={`espace-${space.id}`} className="card flex min-w-0 flex-col overflow-hidden">
      <div className="space-rule" aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-5 md:p-6">
        <div className="flex items-start gap-3.5">
          <span className="space-tile size-11" aria-hidden>{space.icon}</span>
          <div className="min-w-0 flex-1">
            <h2 id={`espace-${space.id}`} className="text-lg font-bold text-text">{space.name}</h2>
            <p className="text-sm text-text-muted">{space.tagline}</p>
          </div>
          <StatusBadge tone={STATE_TONE[space.state]} className="shrink-0">{SPACE_STATE_LABEL[space.state]}</StatusBadge>
        </div>
        <p className="text-sm text-text-muted">{space.description}</p>
        {signal ? <div className="min-h-10">{signal}</div> : null}
        <div>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
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
        </div>
        <ul className="flex flex-col gap-1.5 text-sm text-text">
          {space.does.map((d) => (
            <li key={d} className="flex items-start gap-2"><span className="space-dot mt-[7px]" aria-hidden />{d}</li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Link to={space.home} className={buttonClass({ variant: available ? "primary" : "secondary" })} aria-label={`Ouvrir ${space.name}`}>
            Ouvrir {space.id === "selio" ? "Selio" : space.short} <ArrowRight aria-hidden />
          </Link>
          {secondary ? <Link to={secondary.to} className={buttonClass({ variant: "ghost" })}>{secondary.label}</Link> : null}
        </div>
      </div>
    </article>
  );
}

const STEPS = [
  { id: "selio", step: "Gérer", title: "Selio, chaque jour", text: "Sourcing, achat, vente, bordereaux, après-vente et remise en ligne : chaque vente enregistrée devient une donnée utile." },
  { id: "studio", step: "Créer", title: "Studio et Track s'en servent", text: "Studio écrit les annonces à partir de ce qui marche ; Track montre ce que vendent les autres comptes, pour sourcer au bon endroit." },
  { id: "agents", step: "Élargir", title: "Agents, Cloud, nouveaux comptes", text: "Travailler à plusieurs avec les bons accès, faire tourner les automatisations en continu, ouvrir une nouvelle boutique." },
] as const;

/** Carte compacte d'une filiale en développement. */
function DevCard({ space }: { space: SpaceDef }) {
  return (
    <article data-space={space.id} aria-labelledby={`espace-${space.id}`} className="card flex min-w-0 flex-col overflow-hidden">
      <div className="space-rule" aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <span className="space-tile size-10" aria-hidden>{space.icon}</span>
          <div className="min-w-0 flex-1">
            <h3 id={`espace-${space.id}`} className="text-base font-bold text-text">{space.name}</h3>
            <p className="text-sm text-text-muted">{space.tagline}</p>
          </div>
        </div>
        <p className="text-sm text-text-muted">{space.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <StatusBadge tone="neutral">{SPACE_STATE_LABEL[space.state]}</StatusBadge>
          <Link to={space.home} className={buttonClass({ variant: "ghost", size: "sm" })} aria-label={`Découvrir ${space.name}`}>Découvrir <ArrowRight aria-hidden /></Link>
        </div>
      </div>
    </article>
  );
}

export default function Hub() {
  const client = useClient();
  const session = useRequiredSession();
  const overview = useQuery({ queryKey: ["overview", "month"], queryFn: () => client.getOverview("month") });
  const counts = useNavCounts();
  const items = useAllItems();
  const scores = useDressingScores();
  const whiteLabel = useQuery({ queryKey: ["white-label"], queryFn: () => client.getWhiteLabel() });
  const members = useQuery({ queryKey: ["members"], queryFn: () => client.listMembers() });
  const studio = items.data ? summarizeGenerated(items.data.items, scores.data) : null;
  const first = session.user.displayName.split(" ")[0];
  const dash = "—";
  const figures: Partial<Record<SpaceDef["id"], Figure[]>> = {
    selio: [
      { label: "CA du mois", value: overview.data ? formatCents(overview.data.sales.revenueCents, { compact: true }) : dash },
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
  };

  // Chiffre d'affaires cumulé jour après jour : la courbe monte à chaque vente du mois.
  const cumulative = (overview.data?.series ?? []).reduce<number[]>((acc, p) => [...acc, (acc.at(-1) ?? 0) + p.revenueCents], []);
  const recent = studio?.generated.slice(0, 5) ?? [];
  const brand = whiteLabel.data;
  const signals: Partial<Record<SpaceDef["id"], ReactNode>> = {
    selio: (cumulative.at(-1) ?? 0) > 0 ? (
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

  return (
    <>
      <PageHeader
        eyebrow={`Bonjour ${first}`}
        title="Selio et ses filiales"
        description="Un compte, une IA, plusieurs outils. Selio gère votre activité au quotidien ; les filiales s'appuient sur ses données, sans rien ressaisir. Pour passer de l'une à l'autre, utilisez le bloc « Vous êtes dans » en haut du menu."
      />

      <h2 className="mb-3 text-sm font-bold tracking-wider text-text uppercase">Disponibles</h2>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {SPACES.filter((s) => s.state !== "development").map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            figures={figures[space.id] ?? []}
            signal={signals[space.id]}
            figuresNote={space.id === "selio" ? "Calculés depuis vos données, ce mois-ci." : space.id === "studio" ? "Note du dressing des annonces en ligne." : <><Tag className="mr-1.5">Aperçu</Tag>Boutiques clientes fictives, rien n'est facturé.</>}
            secondary={space.id === "selio" ? { to: "/app/automatisation", label: "Automatisation" } : space.id === "studio" ? { to: "/studio/performances", label: "Ce qui performe" } : { to: "/app/settings/access", label: "Comptes et accès" }}
          />
        ))}
      </div>

      <h2 className="mt-8 mb-1 text-sm font-bold tracking-wider text-text uppercase">En développement</h2>
      <p className="mb-3 text-sm text-text-muted">Ce qui arrive. Rien n'est activé ni facturé ; chaque page montre aussi ce qui marche déjà dans Selio.</p>
      <div className="grid gap-4 md:grid-cols-3">
        {SPACES.filter((s) => s.state === "development").map((space) => <DevCard key={space.id} space={space} />)}
      </div>

      <section aria-labelledby="enchainement" className="card mt-8 p-5 md:p-6">
        <h2 id="enchainement" className="text-md font-bold text-text">Comment les filiales s'enchaînent</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">D'abord l'outil de gestion, ensuite les filiales spécialisées : rien n'est à ressaisir de l'une à l'autre.</p>
        <ol className="mt-5 grid gap-5 md:grid-cols-3 md:gap-6">
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
        <p className="mt-5 border-t border-border pt-4 text-xs text-text-muted">Les filiales en aperçu ou en développement ne sont ni activées ni facturées. Vos données restent celles de votre organisation : elles alimentent vos propres analyses. Selio est un outil indépendant, ni affilié à Vinted ni approuvé par Vinted.</p>
      </section>
    </>
  );
}
