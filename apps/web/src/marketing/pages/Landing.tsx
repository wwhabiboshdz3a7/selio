import { Link, Navigate, useLocation } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import { TRIAL_DAYS } from "@selio/contracts";
import { buttonClass } from "@selio/ui";
import { Container, CtaBand, Eyebrow, FaqList, IndependenceNotice, JsonLd, NotList, ShotPicture, TrustRow } from "../components";
import { landingByPath, landingFaq, landingProduct, type LandingDef } from "../landings";
import { PRODUCT_SHOTS } from "../productShots";
import { useTheme } from "../../lib/theme";
import { productIcon } from "../spaces";
import { breadcrumbJsonLd, faqPageJsonLd, seoPage, softwareApplicationJsonLd, useMarketingMeta } from "../seo";

/**
 * Page d'atterrissage publicitaire (une par intention de recherche, voir ../landings.ts) : le
 * mot-clé en titre, le bénéfice, l'état réel de la filiale, l'appel à l'essai, trois preuves
 * (fonctions réelles), la capture, les limites assumées, une FAQ courte, puis l'appel final.
 * Légère : aucune animation lourde, la capture du haut est chargée en priorité.
 */
export default function Landing() {
  const { pathname } = useLocation();
  const landing = landingByPath(pathname.replace(/\/+$/, "") || "/");
  if (!landing) return <Navigate to="/" replace />;
  return <LandingView key={landing.path} landing={landing} />;
}

function LandingView({ landing }: { landing: LandingDef }) {
  useMarketingMeta(landing.path);
  const product = landingProduct(landing);
  const shot = PRODUCT_SHOTS[product.slug];
  const faq = landingFaq(landing);
  const proofs = landing.proofs.map((title) => product.does.find((f) => f.title === title)!);
  const seo = seoPage(landing.path);
  const ld = [
    softwareApplicationJsonLd({ name: product.name, path: landing.path, description: seo.description, offers: landing.offers }),
    breadcrumbJsonLd([{ name: "Accueil", path: "/" }, { name: product.name, path: product.path }, { name: seo.title, path: landing.path }]),
    faqPageJsonLd(faq),
  ];
  const ready = product.state.value === "available";
  // Une seule capture chargée, celle du thème affiché (chargée en priorité : souvent l'élément le plus grand).
  const { resolved } = useTheme();
  return (
    <>
      <JsonLd data={ld} />
      <section className="mk-hero pt-10 pb-12 md:pt-16 md:pb-16" aria-labelledby="atterrissage-titre">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
            <div className="max-w-2xl">
              <Eyebrow>{product.name}</Eyebrow>
              <h1 id="atterrissage-titre" className="mk-display mt-4">{landing.title}</h1>
              <p className="mt-4 text-md text-text-muted">{landing.lead}</p>
              <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-text-muted" data-testid="landing-state">
                <span className="mk-badge" data-value={product.state.value}>{product.state.label}</span>
                {ready ? null : <span className="max-w-xl">{product.state.note}</span>}
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Link to="/inscription" className={buttonClass({ variant: "accent", size: "lg", className: "mk-cta-link" })}>
                  Commencer l'essai gratuit de {TRIAL_DAYS} jours <ArrowRight aria-hidden="true" />
                </Link>
                <Link to="/tarifs" className={buttonClass({ variant: "secondary", size: "lg" })}>Voir les tarifs</Link>
              </div>
              {landing.ctaNote ? <p className="mt-3 text-sm text-text-muted">{landing.ctaNote}</p> : null}
              <TrustRow className="mt-6" only={["carte", "essai", "resiliable", "france"]} />
            </div>
            {shot ? (
              <figure className="m-0">
                <div className="mk-landing-shot">
                  <ShotPicture src={resolved === "dark" ? shot.dark : shot.light} alt={product.shot.alt} sizes="(min-width: 1024px) 600px, calc(100vw - 32px)" priority />
                </div>
                <figcaption className="mt-3 text-xs text-text-muted">{product.shot.caption}</figcaption>
              </figure>
            ) : null}
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-12 md:py-16" aria-labelledby="preuves-titre">
        <Container>
          <Eyebrow>Concrètement</Eyebrow>
          <h2 id="preuves-titre" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Ce que vous obtenez avec {product.name}</h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-3" data-testid="landing-proofs">
            {proofs.map((f) => (
              <li key={f.title} className="card mk-card flex flex-col p-5">
                <span className="mk-icon mb-4" aria-hidden>{productIcon(product)}</span>
                <h3 className="text-md font-semibold text-text">{f.title}</h3>
                <p className="mt-1.5 flex-1 text-sm text-text-muted">{f.text}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 grid gap-6 rounded-xl border border-border bg-surface p-5 md:grid-cols-2 md:p-6">
            <div>
              <h3 className="text-md font-semibold text-text">Toujours sous votre contrôle</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {["Vous validez les actions importantes : prix, publication, achat.", "Ce qui est encore simulé est signalé à l'écran, jamais présenté comme réel."].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-sm text-text"><Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-md font-semibold text-text">Ce que {product.name} ne fait pas</h3>
              <div className="mt-3"><NotList items={landing.limits} /></div>
            </div>
          </div>
          <p className="mt-6">
            <Link to={product.path} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Tout sur {product.name} <ArrowRight className="size-4" aria-hidden /></Link>
          </p>
        </Container>
      </section>

      <section className="border-t border-border bg-surface py-12 md:py-16" aria-labelledby="faq-atterrissage">
        <Container className="max-w-3xl">
          <Eyebrow>Questions fréquentes</Eyebrow>
          <h2 id="faq-atterrissage" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Avant de vous lancer</h2>
          <FaqList className="mt-6" items={faq} />
          <p className="mt-6 text-sm text-text-muted">D'autres questions ? <Link to="/faq" className="font-medium text-accent hover:underline">Toute l'aide</Link> ou <Link to="/contact" className="font-medium text-accent hover:underline">écrivez-nous</Link>.</p>
          <IndependenceNotice className="mt-8" />
        </Container>
      </section>

      <CtaBand seed={landing.path.length} title={`Essayez ${product.name} sur votre propre activité`} lead={`${TRIAL_DAYS} jours avec toutes les fonctions du plan Pro. Rien n'est débité pendant l'essai ; tout ce qui est encore simulé est signalé à l'écran.`} />
    </>
  );
}
