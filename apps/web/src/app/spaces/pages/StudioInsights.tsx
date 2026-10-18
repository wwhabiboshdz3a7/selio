import { Link } from "react-router";
import { Lightbulb, Sparkles } from "lucide-react";
import { INSIGHT_MIN_SAMPLE, INSIGHT_SOLID_SAMPLE, type InsightBucket, type InsightDimension, type InsightFinding } from "@selio/domain";
import { Alert, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Tag, buttonClass, cn } from "@selio/ui";
import { errorMessage } from "../../../lib/errors";
import { STUDIO_MAX_ITEMS, useListingInsights } from "../studio-data";

/** Pourcentage arrondi à l'unité, comme dans les constats. */
const pct = (v: number) => `${Math.round(v * 100)} %`;

function StrengthTag({ strength }: { strength: InsightFinding["strength"] }) {
  return strength === "solid" ? <Tag accent className="shrink-0 whitespace-nowrap">Écart net</Tag> : <Tag className="shrink-0 whitespace-nowrap">Tendance à confirmer</Tag>;
}

function Buckets({ dimension }: { dimension: InsightDimension }) {
  const best = dimension.finding?.best.key;
  return (
    <ul className="flex flex-col gap-3">
      {dimension.buckets.map((b: InsightBucket) => {
        const small = b.count < INSIGHT_MIN_SAMPLE;
        return (
          <li key={b.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0 truncate", b.key === best ? "font-medium text-text" : "text-text")}>{b.label}</span>
              <span className="num shrink-0 font-medium text-text">{pct(b.sellRate)} <span className="font-normal text-text-muted">vendues</span></span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div className={cn("h-full rounded-full", small ? "bg-border-strong" : "bg-accent-vivid")} style={{ width: `${Math.round(b.sellRate * 100)}%` }} />
            </div>
            <p className="num mt-1 text-xs text-text-muted">
              {b.count} annonce{b.count > 1 ? "s" : ""} · {b.sold} vendue{b.sold > 1 ? "s" : ""}
              {b.favoriteRate !== null ? ` · ${pct(b.favoriteRate)} de favoris` : ""}
              {b.medianDaysToSell !== null ? ` · vendue en ${b.medianDaysToSell} j (médiane)` : ""}
              {small ? " · trop peu d'annonces pour comparer" : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const RULES = [
  { t: "Titre de 20 à 70 caractères, marque en tête", d: "Marque + type de pièce + couleur + taille : ce sont les mots recherchés." },
  { t: "8 photos", d: "Face, dos, étiquette, matière, défauts, portée." },
  { t: "Description de 150 caractères ou plus", d: "Mesures, matière, état précis, défauts éventuels." },
  { t: "Marque, taille et couleur renseignées", d: "Les filtres de recherche s'en servent." },
  { t: "Prix au niveau des ventes comparables", d: "Au-delà de 10 % au-dessus, la note baisse." },
];

export default function StudioInsights() {
  const { items, sales, insights } = useListingInsights();
  const failed = items.isError ? items.error : sales.isError ? sales.error : null;
  const truncated = items.data ? items.data.total > STUDIO_MAX_ITEMS : false;

  return (
    <>
      <PageHeader
        eyebrow="Selio Studio"
        title="Ce qui performe"
        description={insights ? `Ce que vos propres annonces apprennent, calculé sur vos ${insights.sample.listed} annonces mises en ligne (dont ${insights.sample.sold} vendues et ${insights.sample.generated} rédigées avec le générateur). Aucune donnée extérieure, aucun chiffre inventé.` : "Ce que vos propres annonces apprennent : titres, photos, descriptions, attributs et prix, comparés à vos ventes."}
        actions={<Link to="/studio" className={buttonClass({ variant: "brand" })}><Sparkles aria-hidden /> Créer une annonce</Link>}
      />

      {failed ? <ErrorState description={errorMessage(failed)} onRetry={() => { void items.refetch(); void sales.refetch(); }} /> : !insights ? <SkeletonRows /> : insights.sample.listed === 0 ? (
        <EmptyState title="Pas encore d'annonce mise en ligne" description="Les enseignements apparaissent dès que vos annonces sont en ligne et que les premières ventes arrivent." action={<Link to="/studio" className={buttonClass({ variant: "brand" })}><Sparkles aria-hidden /> Créer une annonce</Link>} />
      ) : (
        <>
          {insights.sample.listed < 50 ? (
            <Alert tone="info" className="mb-6" title={`Échantillon modeste : ${insights.sample.listed} annonces`}>
              Un groupe n'est comparé qu'à partir de {INSIGHT_MIN_SAMPLE} annonces, et un écart n'est dit « net » qu'à partir de {INSIGHT_SOLID_SAMPLE} annonces de chaque côté. Les tendances se précisent à chaque vente.
            </Alert>
          ) : null}
          {truncated ? <Alert tone="info" className="mb-6">Calculé sur vos {STUDIO_MAX_ITEMS} articles les plus récents.</Alert> : null}

          <section aria-labelledby="a-retenir" className="mb-8">
            <h2 id="a-retenir" className="mb-3 text-md font-semibold text-text">À retenir</h2>
            {insights.highlights.length === 0 ? (
              <Card className="text-sm text-text-muted">Pas encore d'écart net entre vos annonces : continuez à publier, les enseignements apparaîtront avec les prochaines ventes.</Card>
            ) : (
              <ol className="grid gap-3 lg:grid-cols-3">
                {insights.highlights.map((f) => (
                  <li key={f.dimension} className="card flex flex-col gap-2 p-4 md:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted"><Lightbulb className="size-3.5 text-gold" aria-hidden />{insights.dimensions.find((d) => d.key === f.dimension)?.label}</span>
                      <StrengthTag strength={f.strength} />
                    </div>
                    <p className="text-sm text-text">{f.text}</p>
                    <p className="mt-auto text-xs text-text-muted">{f.metric === "sellRate" ? "Mesure : annonces vendues / annonces mises en ligne." : "Mesure : favoris / vues, faute d'écart net sur les ventes."}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            {insights.dimensions.filter((d) => d.buckets.length > 0).map((d) => (
              <Card key={d.key} className="flex flex-col">
                <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{d.label}</p>
                <h3 className="mt-1 mb-4 text-md font-semibold text-text">{d.question}</h3>
                <Buckets dimension={d} />
                <div className="mt-4 border-t border-border pt-3 text-sm">
                  {d.finding ? (
                    <p className="flex flex-wrap items-start gap-2 text-text"><StrengthTag strength={d.finding.strength} /><span className="min-w-0 flex-1">{d.finding.text}</span></p>
                  ) : d.buckets.length < 2 ? (
                    <p className="text-text-muted">Toutes vos annonces sont dans le même groupe : rien à comparer pour l'instant.</p>
                  ) : (
                    <p className="text-text-muted">Pas d'écart net sur vos annonces pour l'instant.</p>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <Card className="mt-8">
            <h2 className="text-md font-semibold text-text">Repères de la note du dressing</h2>
            <p className="mt-1 text-sm text-text-muted">Les règles qui font monter la note de chaque annonce. Ce sont des règles de calcul, pas une mesure de vos ventes ; le générateur les applique déjà.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {RULES.map((r) => (
                <li key={r.t} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-text">{r.t}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{r.d}</p>
                </li>
              ))}
            </ul>
          </Card>

          <p className="mt-4 text-xs text-text-muted">Comment c'est calculé : chaque annonce déjà mise en ligne (en vente, réservée, vendue ou retirée) est rangée dans un groupe par critère. Taux de vente = annonces vendues / annonces du groupe ; favoris = favoris / vues ; délai = jours entre la mise en ligne et la vente (médiane). Le prix est comparé à la médiane de vos autres ventes de la même marque et catégorie (au moins deux).</p>
        </>
      )}
    </>
  );
}
