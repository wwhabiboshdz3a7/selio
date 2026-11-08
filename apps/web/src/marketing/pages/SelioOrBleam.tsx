import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Alert } from "@selio/ui";
import { CheckList, Container, CtaBand, IndependenceNotice, JsonLd, MarketingSection, Placeholder } from "../components";
import { BLEAM_SOURCE_DATE, COMPARISON_ROWS, ELIAS_PLACEHOLDER, MIGRATION_STEPS, SELIO_PRINCIPLES, UNSOURCED_PLACEHOLDER } from "../comparison";
import { breadcrumbJsonLd, COMPARISON_READY, useMarketingMeta } from "../seo";

/** Bandeau tant que les textes d'Elias et la relecture de l'avocat manquent. */
export function ComparisonDraftBanner() {
  if (COMPARISON_READY) return null;
  return (
    <Container className="pt-6">
      <Alert tone="info" title="Page en préparation">
        Les textes de cette page sont attendus (emplacements « {ELIAS_PLACEHOLDER} ») et le comparatif doit être relu par un avocat avant publication. La page n'est pas référencée d'ici là.
      </Alert>
    </Container>
  );
}

/** Mentions communes aux pages de comparaison : marques citées, indépendance, sources. */
export function ComparisonFootnotes() {
  return (
    <section className="border-t border-border py-10" aria-labelledby="sources-comparatif">
      <Container className="max-w-3xl">
        <h2 id="sources-comparatif" className="text-md font-semibold text-text">Sources et méthode</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-muted">
          <li>Ce qui est dit de Selio décrit le produit tel qu'il est construit aujourd'hui, y compris ce qui est encore en démonstration ou en développement (voir chaque page produit).</li>
          <li>Ce qui est dit de Bleam vient de ses pages publiques (fiche App Store, site officiel), relevées le {BLEAM_SOURCE_DATE} ; à revérifier avant publication. Une case « {UNSOURCED_PLACEHOLDER} » signifie que nous n'affirmons rien.</li>
          <li>Bleam, V-Tools et Clemz sont des marques de leurs propriétaires respectifs, citées à titre de comparaison. Selio n'est affilié à aucun d'eux.</li>
        </ul>
        <IndependenceNotice className="mt-4" />
      </Container>
    </section>
  );
}

export default function SelioOrBleam() {
  useMarketingMeta("/selio-ou-bleam");
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Accueil", path: "/" }, { name: "Selio ou Bleam ?", path: "/selio-ou-bleam" }])} />
      <ComparisonDraftBanner />
      <MarketingSection level={1} eyebrow="Comparatif" title="Selio ou Bleam ?" lead={<Placeholder>{ELIAS_PLACEHOLDER} Introduction : à qui s'adresse ce comparatif.</Placeholder>}>
        <div className="mk-placeholder-block max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} En bref : la réponse courte, en trois phrases.</div>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Le comparatif" title="Ce que fait chaque outil, avec les sources" lead="Côté Selio, ce qui est construit aujourd'hui. Côté Bleam, seulement ce que ses pages publiques disent, avec la source.">
        <div className="card overflow-x-auto">
          <table className="mk-compare">
            <caption className="sr-only">Comparatif Selio et Bleam, critère par critère</caption>
            <thead>
              <tr><th scope="col">Critère</th><th scope="col">Selio</th><th scope="col">Bleam</th></tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((r) => (
                <tr key={r.criterion}>
                  <th scope="row">{r.criterion}</th>
                  <td data-label="Selio">{r.selio}</td>
                  <td data-label="Bleam">
                    {r.bleam ? (
                      <>
                        {r.bleam.text}
                        <span className="mk-source">Source : {r.bleam.source}, relevé du {BLEAM_SOURCE_DATE}</span>
                      </>
                    ) : (
                      <Placeholder>{UNSOURCED_PLACEHOLDER}</Placeholder>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MarketingSection>

      <MarketingSection className="border-t border-border bg-surface" eyebrow="Nos principes" title="Ce que Selio fait différemment">
        <div className="grid gap-4 md:grid-cols-2">
          {SELIO_PRINCIPLES.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-bg p-5">
              <h3 className="text-md font-semibold text-text">{p.title}</h3>
              <p className="mt-1.5 text-sm text-text-muted">{p.text}</p>
            </div>
          ))}
        </div>
        <div className="mk-placeholder-block mt-6 max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} Ce qui compte le plus pour un revendeur qui hésite.</div>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Changer d'outil" title="Passer de Bleam à Selio, sans donner vos identifiants">
        <div className="max-w-3xl">
          <CheckList items={[...MIGRATION_STEPS]} />
          <p className="mt-6">
            <Link to="/demo?vers=/app/settings/migration" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Voir la migration dans la démo <ArrowRight className="size-4" aria-hidden /></Link>
          </p>
        </div>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="En toute honnêteté" title="Quand Bleam peut rester le bon choix">
        <div className="mk-placeholder-block max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} Les cas où Bleam convient mieux, sans dénigrement.</div>
      </MarketingSection>

      <MarketingSection className="border-t border-border" eyebrow="Questions" title="Questions fréquentes">
        <div className="mk-placeholder-block max-w-3xl" data-placeholder="">{ELIAS_PLACEHOLDER} Trois à cinq questions et réponses.</div>
        <p className="mt-6">
          <Link to="/alternative-bleam" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Une alternative à Bleam, V-Tools ou Clemz <ArrowRight className="size-4" aria-hidden /></Link>
        </p>
      </MarketingSection>

      <ComparisonFootnotes />
      <CtaBand seed={41} title="Jugez sur pièce" lead="La démonstration montre Selio avec des données fictives, sans compte ni carte bancaire." />
    </>
  );
}
