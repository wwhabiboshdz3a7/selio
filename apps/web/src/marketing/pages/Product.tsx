import { Link, Navigate, useParams } from "react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
import { TRIAL_DAYS } from "@selio/contracts";
import { buttonClass } from "@selio/ui";
import { Container, CtaBand, Eyebrow, IndependenceNotice, JsonLd, MarketingSection, NightSky, NotList, ShotPicture, TrustRow } from "../components";
import { LEGACY_PRODUCT_SLUGS, MANAGER_FEATURES, PRODUCTS, productBySlug, type ProductDef } from "../products";
import { productIcon } from "../spaces";
import { PRODUCT_SHOTS } from "../productShots";
import { breadcrumbJsonLd, softwareApplicationJsonLd, useMarketingMeta } from "../seo";

/**
 * Page d'une filiale (/produits/manager, /studio, /track, /bot, /compte) ou d'une fonctionnalité
 * de Selio Manager (/produits/cloud, /agent). Anciennes adresses : /produits/radar mène à Selio
 * Bot, /produits/comptes à Selio Compte, /produits/agents à Selio Agent.
 */
export default function Product() {
  const { slug } = useParams();
  const legacy = slug ? LEGACY_PRODUCT_SLUGS[slug] : undefined;
  if (legacy) return <Navigate to={`/produits/${legacy}`} replace />;
  const product = productBySlug(slug);
  if (!product) return <Navigate to="/plateforme" replace />;
  return <ProductView key={product.slug} product={product} />;
}

const MANAGER = PRODUCTS[0]!;

function ProductView({ product }: { product: ProductDef }) {
  useMarketingMeta(product.path);
  const shot = PRODUCT_SHOTS[product.slug];
  const icon = productIcon(product);
  const feature = product.kind === "feature";
  // Selio Compte est une prestation : on demande un devis, on ne s'y inscrit pas.
  const service = product.slug === "compte";
  const crumbs = feature
    ? [{ name: "Accueil", path: "/" }, { name: "Plateforme", path: "/plateforme" }, { name: MANAGER.name, path: MANAGER.path }, { name: product.name, path: product.path }]
    : [{ name: "Accueil", path: "/" }, { name: "Plateforme", path: "/plateforme" }, { name: product.name, path: product.path }];
  // Une fonctionnalité n'est pas un produit : seul le fil d'Ariane est décrit, pas une application.
  const ld = feature ? [breadcrumbJsonLd(crumbs)] : [softwareApplicationJsonLd({ name: product.name, path: product.path, description: product.lead }), breadcrumbJsonLd(crumbs)];
  const others = PRODUCTS.filter((p) => p.slug !== product.slug);
  return (
    <>
      <JsonLd data={ld} />
      {feature ? (
        <Container>
          <nav aria-label="Fil d'Ariane" className="pt-8 md:pt-10">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
              <li><Link to={MANAGER.path} className="font-medium text-accent hover:underline">{MANAGER.name}</Link></li>
              <li aria-hidden><ChevronRight className="size-3.5" /></li>
              <li aria-current="page" className="text-text">{product.name}</li>
            </ol>
          </nav>
        </Container>
      ) : null}
      <MarketingSection level={1} reveal eyebrow={feature ? `${product.name} · fonctionnalité de ${MANAGER.name}` : product.name} title={product.promise} lead={product.lead}>
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
            <span className="mk-badge" data-value={product.state.value}>{product.state.label}</span>
            <span className="max-w-2xl">{product.state.note}</span>
          </p>
          {product.distinction ? (
            <p className="max-w-3xl rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text" data-testid="manager-bot-distinction">{product.distinction}</p>
          ) : null}
          <div className="flex flex-wrap gap-2.5">
            {service
              ? <Link to="/contact" className={buttonClass({ variant: "accent" })}>Demander un devis</Link>
              : <Link to="/inscription" className={buttonClass({ variant: "accent" })}>Commencer l'essai gratuit de {TRIAL_DAYS} jours</Link>}
            <Link to="/tarifs" className={buttonClass({ variant: "secondary" })}>Voir les tarifs</Link>
          </div>
          {service ? null : <TrustRow only={["carte", "essai", "resiliable"]} />}
        </div>
      </MarketingSection>

      <MarketingSection reveal className="border-t border-border" eyebrow="Ce qu'il fait" title={`Ce que fait ${product.name}`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {product.does.map((f) => (
            <div key={f.title} className="card mk-card flex flex-col p-5" data-reveal="">
              <span className="mk-icon mb-4" aria-hidden>{icon}</span>
              <h3 className="text-md font-semibold text-text">{f.title}</h3>
              <p className="mt-1.5 flex-1 text-sm text-text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      {product.slug === "manager" ? <ManagerFeatures /> : null}

      <section className="border-t border-border bg-surface py-12 md:py-16">
        <Container>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
            <div>
              <Eyebrow>Limites assumées</Eyebrow>
              <h2 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">{`Ce que ${product.name} ne fait pas`}</h2>
              <div className="mt-6"><NotList items={product.doesNot} /></div>
            </div>
            <figure className="m-0">
              {shot ? (
                <div className="mk-product-shot">
                  <ShotPicture src={shot.light} alt={product.shot.alt} sizes="(min-width: 1024px) 640px, calc(100vw - 32px)" className="block dark:hidden" />
                  <ShotPicture src={shot.dark} alt={product.shot.alt} sizes="(min-width: 1024px) 640px, calc(100vw - 32px)" className="hidden dark:block" />
                </div>
              ) : (
                <div className="mk-night flex min-h-56 items-center justify-center px-6 py-10" role="img" aria-label={`${product.name} : illustration, capture d'écran à venir`}>
                  <NightSky seed={product.slug.length * 7} lines={false} />
                  <p className="mk-night-text relative text-center text-sm">{product.name}</p>
                </div>
              )}
              <figcaption className="mt-3 text-xs text-text-muted">{shot ? product.shot.caption : "Capture d'écran à venir."}</figcaption>
            </figure>
          </div>
        </Container>
      </section>

      <MarketingSection reveal eyebrow="Prix" title="Combien ça coûte ?">
        <div className="card flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <p className="text-md font-semibold text-text">Prix : voir les tarifs</p>
            <p className="mt-1 max-w-3xl text-sm text-text-muted">{product.pricingNote} Montants indicatifs, non définitifs.</p>
          </div>
          <Link to={product.pricingHref} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Voir les tarifs <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
      </MarketingSection>

      <section className="border-t border-border py-12 md:py-16" aria-labelledby="autres-produits">
        <Container>
          <h2 id="autres-produits" className="text-md font-semibold text-text">{feature ? "Les cinq filiales Selio" : "Les autres filiales Selio"}</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map((p) => (
              <li key={p.slug}>
                <Link to={p.path} className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-text hover:text-accent">{p.name}</Link>
              </li>
            ))}
          </ul>
          <IndependenceNotice className="mt-8" />
        </Container>
      </section>

      <CtaBand seed={product.slug.length + 3} title={`Essayez Selio pendant ${TRIAL_DAYS} jours`} lead="Toutes les fonctions du plan Pro sur votre propre activité. Rien n'est débité avant la fin de l'essai ; tout ce qui est encore simulé est signalé à l'écran." />
    </>
  );
}

/** Sur la page de Selio Manager : ses deux fonctionnalités intégrées, chacune vers sa page. */
function ManagerFeatures() {
  return (
    <MarketingSection reveal id="fonctionnalites-integrees" className="scroll-mt-14 border-t border-border" eyebrow="Fonctionnalités intégrées" title="Selio Cloud et Selio Agent, dans Selio Manager" lead="Deux fonctionnalités de Selio Manager, pas des produits à part : elles complètent ses possibilités.">
      <div className="grid gap-4 md:grid-cols-2">
        {MANAGER_FEATURES.map((f) => (
          <article key={f.slug} id={f.slug} className="card mk-card flex scroll-mt-20 flex-col p-5 md:p-6" data-reveal="" aria-labelledby={`fonctionnalite-${f.slug}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="mk-icon" aria-hidden>{productIcon(f)}</span>
              <span className="mk-badge" data-value={f.state.value}>{f.state.label}</span>
            </div>
            <h3 id={`fonctionnalite-${f.slug}`} className="mt-4 text-md font-semibold text-text">{f.name}</h3>
            <p className="mt-1 flex-1 text-sm text-text-muted">{f.tagline}</p>
            <p className="mt-4">
              <Link to={f.path} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                Découvrir<span className="sr-only"> {f.name}</span> <ArrowRight className="size-4" aria-hidden />
              </Link>
            </p>
          </article>
        ))}
      </div>
    </MarketingSection>
  );
}
