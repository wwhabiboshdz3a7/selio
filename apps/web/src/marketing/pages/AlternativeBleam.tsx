import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { CheckList, CtaBand, JsonLd, MarketingSection, Placeholder } from "../components";
import { ELIAS_PLACEHOLDER, MIGRATION_STEPS, SELIO_PRINCIPLES, UNSOURCED_PLACEHOLDER } from "../comparison";
import { PRODUCTS } from "../products";
import { breadcrumbJsonLd, useMarketingMeta } from "../seo";
import { ComparisonDraftBanner, ComparisonFootnotes } from "./SelioOrBleam";

export default function AlternativeBleam() {
  useMarketingMeta("/alternative-bleam");
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Accueil", path: "/" }, { name: "Alternative à Bleam", path: "/alternative-bleam" }])} />
      <ComparisonDraftBanner />
      <MarketingSection level={1} eyebrow="Alternative à Bleam" title="Une alternative à Bleam, V-Tools ou Clemz pour gérer Vinted" lead={<Placeholder>{ELIAS_PLACEHOLDER} Accroche : pour qui, et pourquoi Selio.</Placeholder>} />

      <MarketingSection className="border-t border-border" eyebrow="Pourquoi changer" title="Pourquoi chercher une alternative">
        <div className="mk-placeholder-block max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} Les raisons qui reviennent chez les revendeurs, avec leurs mots.</div>
      </MarketingSection>

      <MarketingSection className="border-t border-border bg-surface" eyebrow="Le logiciel Vinted de Selio" title="Ce que propose Selio" lead="Un outil revendeur Vinted pour la gestion au quotidien, et des filiales pour le reste. Chaque page dit ce qui est prêt et ce qui ne l'est pas.">
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PRODUCTS.map((p) => (
            <li key={p.slug} className="flex flex-col rounded-xl border border-border bg-bg p-5">
              <p className="text-sm font-semibold text-text">{p.name}</p>
              <p className="mt-1 flex-1 text-sm text-text-muted">{p.promise}</p>
              <p className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="mk-badge" data-value={p.state.value}>{p.state.label}</span>
                <Link to={p.path} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">En savoir plus<span className="sr-only"> sur {p.name}</span> <ArrowRight className="size-4" aria-hidden /></Link>
              </p>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Automatisation Vinted, avec des limites" title="Nos principes">
        <div className="grid gap-4 md:grid-cols-2">
          {SELIO_PRINCIPLES.map((p) => (
            <div key={p.title} className="card p-5">
              <h3 className="text-md font-semibold text-text">{p.title}</h3>
              <p className="mt-1.5 text-sm text-text-muted">{p.text}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Changer d'outil" title="Venir de Bleam, V-Tools ou Clemz sans donner vos identifiants">
        <div className="max-w-3xl"><CheckList items={[...MIGRATION_STEPS]} /></div>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Et les autres outils ?" title="V-Tools, Clemz et les autres">
        <div className="mk-placeholder-block max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} Ce qui distingue Selio, sans affirmation sur un concurrent qui ne soit pas sourcée.</div>
        <p className="mt-4 max-w-3xl text-sm text-text-muted">Aucun comparatif avec V-Tools ou Clemz n'est publié tant qu'il n'est pas sourcé ({UNSOURCED_PLACEHOLDER}).</p>
        <p className="mt-6">
          <Link to="/selio-ou-bleam" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Le comparatif détaillé : Selio ou Bleam ? <ArrowRight className="size-4" aria-hidden /></Link>
        </p>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Questions" title="Questions fréquentes">
        <div className="mk-placeholder-block max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} Trois à cinq questions et réponses.</div>
      </MarketingSection>

      <ComparisonFootnotes />
      <CtaBand seed={43} title="Essayez Selio avec des données fictives" lead="La démonstration ne demande ni compte ni carte bancaire, et ne touche jamais à votre compte Vinted." />
    </>
  );
}
