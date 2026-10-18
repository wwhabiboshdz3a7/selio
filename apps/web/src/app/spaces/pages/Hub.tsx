import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { AGENCY_EXAMPLE_CLIENTS } from "@selio/demo-data";
import { PageHeader, StatusBadge, Tag, buttonClass, cn, formatCents, formatNumber } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { Sparkline } from "../../../components/charts";
import { ItemThumb } from "../../components/common";
import { BrandMark, initialsOf } from "../components";
import { useNavCounts } from "../../layout";
import { SPACES, SPACE_STATE_LABEL, type SpaceDef, type SpaceState } from "../spaces";
import { summarizeGenerated, useAllItems, useDressingScores } from "../studio-data";
import { MARKETPLACES, MARKETS, MARKET_STATE_LABEL } from "../global-data";

interface Figure { label: string; value: ReactNode; hint?: string }

const STATE_TONE: Record<SpaceState, "success" | "accent" | "neutral"> = { available: "success", preview: "accent", planned: "neutral" };

function SpaceCard({ space, figures, figuresNote, signal, secondary }: { space: SpaceDef; figures: Figure[]; figuresNote?: ReactNode; signal?: ReactNode; secondary?: { to: string; label: string } }) {
  const available = space.state === "available";
  return (
    <article data-space={space.id} aria-labelledby={`espace-${space.id}`} className="card flex min-w-0 flex-col overflow-hidden">
      <div className="space-rule" aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-5 md:p-6">
        <div className="flex items-start gap-3.5">
          <span className="space-tile size-11" aria-hidden>{space.icon}</span>
          <div className="min-w-0 flex-1">
            <h2 id={`espace-${space.id}`} className="text-lg font-semibold text-text">{space.name}</h2>
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
            Ouvrir {space.short === "Gestion" ? "Selio" : space.name.replace("Selio ", "")} <ArrowRight aria-hidden />
          </Link>
          {secondary ? <Link to={secondary.to} className={buttonClass({ variant: "ghost" })}>{secondary.label}</Link> : null}
        </div>
      </div>
    </article>
  );
}

const STEPS = [
  { id: "selio", step: "Gérer", title: "Selio, chaque jour", text: "Stock, messages, négociation, commandes : chaque vente enregistrée devient une donnée utile — ce qui part, à quel prix, en combien de temps." },
  { id: "studio", step: "Créer", title: "Studio s'en sert", text: "Ce que vos ventes apprennent sert à écrire les annonces suivantes : Studio rédige à partir de vos photos et montre ce qui performe." },
  { id: "agence", step: "Élargir", title: "Agence et Global", text: "Gérer d'autres boutiques à vos couleurs, vendre dans d'autres pays et sur d'autres places de marché, avec le même compte et la même IA." },
] as const;

export default function Hub() {
  const client = useClient();
  const session = useRequiredSession();
  const overview = useQuery({ queryKey: ["overview", "month"], queryFn: () => client.getOverview("month") });
  const counts = useNavCounts();
  const items = useAllItems();
  const scores = useDressingScores();
  const whiteLabel = useQuery({ queryKey: ["white-label"], queryFn: () => client.getWhiteLabel() });
  const studio = items.data ? summarizeGenerated(items.data.items, scores.data) : null;
  const first = session.user.displayName.split(" ")[0];
  const dash = "—";
  const openMarkets = MARKETS.filter((m) => m.state === "available");
  const preparing = MARKETS.filter((m) => m.state !== "available").length;
  const planned = MARKETPLACES.filter((m) => m.state === "planned").length;

  const figures: Record<SpaceDef["id"], Figure[]> = {
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
    agence: [
      { label: "Boutiques", value: formatNumber(AGENCY_EXAMPLE_CLIENTS.length), hint: "exemples fictifs" },
      { label: "Marque blanche", value: whiteLabel.data ? whiteLabel.data.name : "À créer" },
      { label: "Encaissé", value: formatCents(0, { compact: true }), hint: "rien n'est facturé" },
    ],
    global: [
      { label: "Marché ouvert", value: openMarkets.map((m) => m.name).join(", ") || dash },
      { label: "Pays en préparation", value: formatNumber(preparing) },
      { label: "Places de marché", value: `${planned} prévues`, hint: "après Vinted" },
    ],
  };

  // Chiffre d'affaires cumulé jour après jour : la courbe monte à chaque vente du mois.
  const cumulative = (overview.data?.series ?? []).reduce<number[]>((acc, p) => [...acc, (acc.at(-1) ?? 0) + p.revenueCents], []);
  const recent = studio?.generated.slice(0, 5) ?? [];
  const brand = whiteLabel.data;
  const signals: Record<SpaceDef["id"], ReactNode> = {
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
    agence: (
      <div className="flex items-center gap-3">
        <BrandMark initials={brand?.initials ?? initialsOf(session.org.name)} accent={brand?.accent} size={36} />
        <p className="min-w-0 text-xs text-text-muted">
          <span className="block truncate text-text">{brand ? brand.name : "Votre marque blanche : à créer"}</span>
          {brand ? "Votre marque, enregistrée dans la démonstration" : "Nom, logo texte et couleur, avec l'aperçu en direct"}
        </p>
      </div>
    ),
    global: (
      <ul className="flex flex-wrap gap-1" aria-label="Marchés">
        {MARKETS.map((m) => (
          <li key={m.code} title={`${m.name} — ${MARKET_STATE_LABEL[m.state]}`} className={cn("num inline-flex h-6 min-w-8 items-center justify-center rounded-sm px-1.5 text-[11px] font-semibold", m.state === "available" ? "bg-[var(--space-tint-soft)] text-[var(--space-tint-ink)]" : m.state === "preparing" ? "border border-border text-text-muted" : "border border-dashed border-border text-text-subtle")}>
            <span className="sr-only">{m.name} : {MARKET_STATE_LABEL[m.state]} — </span>{m.code}
          </li>
        ))}
      </ul>
    ),
  };

  return (
    <>
      <PageHeader
        eyebrow={`Bonjour ${first}`}
        title="Vos espaces Selio"
        description="Un compte, une IA, quatre espaces. Selio gère votre activité au quotidien ; Studio, Agence et Global s'appuient sur ses données. Passez de l'un à l'autre depuis le haut du menu."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {SPACES.map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            figures={figures[space.id]}
            signal={signals[space.id]}
            figuresNote={space.id === "selio" ? "Calculés depuis vos données, ce mois-ci." : space.id === "studio" ? "Note du dressing des annonces en ligne, calculée sur vos annonces." : space.id === "agence" ? <><Tag className="mr-1.5">Exemple fictif</Tag>Aucune boutique réelle, aucun paiement.</> : "Marchés et places de marché : rien n'est encore connecté."}
            secondary={space.id === "selio" ? { to: "/app/messages", label: "Messagerie" } : space.id === "studio" ? { to: "/studio/performances", label: "Ce qui performe" } : space.id === "agence" ? { to: "/agence/marque-blanche", label: "Marque blanche" } : { to: "/global/tailles", label: "Convertisseur de tailles" }}
          />
        ))}
      </div>

      <section aria-labelledby="enchainement" className="card mt-8 p-5 md:p-6">
        <h2 id="enchainement" className="text-md font-semibold text-text">Comment les espaces s'enchaînent</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">D'abord l'outil de gestion, ensuite les espaces spécialisés : rien n'est à ressaisir d'un espace à l'autre.</p>
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
        <p className="mt-5 border-t border-border pt-4 text-xs text-text-muted">Les espaces en aperçu ou en préparation ne sont ni activés ni facturés. Vos données restent celles de votre organisation : elles alimentent vos propres analyses. Selio est un outil indépendant, ni affilié à Vinted ni approuvé par Vinted.</p>
      </section>
    </>
  );
}
