import { Link } from "react-router";
import { Alert, Button, formatCents } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { CheckList, Container, MarketingSection } from "../components";
import { PLAN_CARDS } from "../../lib/plans";
import { showIndicativePricing } from "../../lib/env";

export default function Pricing() {
  usePageMeta("Tarifs", "Structure tarifaire de Selio : plans Découverte, Essentiel et Pro avec quotas d'articles, de suggestions IA et d'automatisations. Montants indicatifs.");
  return (
    <>
      <MarketingSection eyebrow="Tarifs" title="Trois plans, des quotas clairs" lead="La structure est définie ; les montants affichés sont indicatifs et pourront évoluer avant l'ouverture des abonnements. Aucun paiement n'est encaissé à ce stade.">
        <Alert tone="info" title="Montants indicatifs">Les prix ci-dessous servent à illustrer la structure. Ils ne constituent pas une offre ferme. Les abonnements réels seront activés après validation de l'intégration de paiement (mode test uniquement pour l'instant).</Alert>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {PLAN_CARDS.map((p) => (
            <article key={p.plan} className={p.plan === "starter" ? "card border-accent p-5" : "card p-5"}>
              <h2 className="text-md font-semibold text-text">{p.name}</h2>
              <p className="mt-1 text-sm text-text-muted">{p.tagline}</p>
              <p className="num mt-4 text-2xl font-semibold text-text">
                {showIndicativePricing && p.indicativeMonthlyCents !== null ? (p.indicativeMonthlyCents === 0 ? "0 €" : formatCents(p.indicativeMonthlyCents, { compact: true })) : "À définir"}
                {showIndicativePricing && p.indicativeMonthlyCents ? <span className="text-sm font-normal text-text-muted"> / mois, indicatif</span> : null}
              </p>
              <div className="mt-4"><CheckList items={p.features} /></div>
              <div className="mt-5">
                <Link to={p.plan === "free" ? "/demo" : "/inscription"}>
                  <Button variant={p.plan === "starter" ? "accent" : "secondary"} fullWidth>{p.plan === "free" ? "Essayer la démo" : "Créer un compte"}</Button>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </MarketingSection>
      <section className="border-t border-border bg-surface py-12">
        <Container>
          <h2 className="text-lg font-semibold text-text">Questions fréquentes sur les tarifs</h2>
          <dl className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="card p-4"><dt className="text-sm font-medium text-text">Y a-t-il un engagement ?</dt><dd className="mt-1 text-sm text-text-muted">La structure prévue est mensuelle sans engagement. Les conditions définitives seront publiées avec l'ouverture des abonnements.</dd></div>
            <div className="card p-4"><dt className="text-sm font-medium text-text">Que se passe-t-il si je dépasse un quota ?</dt><dd className="mt-1 text-sm text-text-muted">L'application affiche la consommation et bloque proprement l'action concernée en expliquant la limite. Aucune facturation surprise.</dd></div>
            <div className="card p-4"><dt className="text-sm font-medium text-text">L'IA est-elle incluse ?</dt><dd className="mt-1 text-sm text-text-muted">Les suggestions IA sont comptées par mois. Elles reposent sur un serveur privé ; si celui-ci est indisponible, les gabarits déterministes continuent de fonctionner.</dd></div>
            <div className="card p-4"><dt className="text-sm font-medium text-text">Puis-je exporter mes données ?</dt><dd className="mt-1 text-sm text-text-muted">Oui, à tout moment et dans tous les plans : export CSV des articles et des analyses, export complet au format JSON, et suppression de l'organisation.</dd></div>
          </dl>
        </Container>
      </section>
    </>
  );
}
