import { Link, Navigate, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { TRIAL_DAYS } from "@selio/contracts";
import { buttonClass } from "@selio/ui";
import { Container, CtaBand, Eyebrow, IndependenceNotice, JsonLd, MarketingSection, NightSky, NotList } from "../components";
import { PRODUCTS, productBySlug, type ProductDef } from "../products";
import { productIcon } from "../spaces";
import { PRODUCT_SHOTS } from "../productShots";
import { breadcrumbJsonLd, softwareApplicationJsonLd, useMarketingMeta } from "../seo";

/** Page d'un produit de la gamme : /produits/manager, /studio, /track, /radar, /bot, /cloud, /agents, /comptes. */
export default function Product() {
  const { slug } = useParams();
  const product = productBySlug(slug);
  if (!product) return <Navigate to="/plateforme" replace />;
  return <ProductView key={product.slug} product={product} />;
}

function ProductView({ product }: { product: ProductDef }) {
  useMarketingMeta(product.path);
  const shot = PRODUCT_SHOTS[product.slug];
  const icon = productIcon(product);
  // Selio Comptes est une prestation : on la demande, on ne s'y inscrit pas.
  const service = product.slug === "comptes";
  const others = PRODUCTS.filter((p) => p.slug !== product.slug);
  return (
    <>
      <JsonLd data={[softwareApplicationJsonLd({ name: product.name, path: product.path, description: product.lead }), breadcrumbJsonLd([{ name: "Accueil", path: "/" }, { name: "Plateforme", path: "/plateforme" }, { name: product.name, path: product.path }])]} />
      <MarketingSection level={1} reveal eyebrow={product.name} title={product.promise} lead={product.lead}>
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
            <span className="mk-badge" data-value={product.state.value}>{product.state.label}</span>
            <span className="max-w-2xl">{product.state.note}</span>
          </p>
          <div className="flex flex-wrap gap-2.5">
            {service
              ? <Link to="/contact" className={buttonClass({ variant: "accent" })}>Demander une prestation</Link>
              : <Link to="/inscription" className={buttonClass({ variant: "accent" })}>Commencer l'essai gratuit de {TRIAL_DAYS} jours</Link>}
            <Link to="/tarifs" className={buttonClass({ variant: "secondary" })}>Voir les tarifs</Link>
          </div>
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
                  <img src={shot.light} alt={product.shot.alt} width={1600} height={1000} loading="lazy" decoding="async" className="block dark:hidden" />
                  <img src={shot.dark} alt={product.shot.alt} width={1600} height={1000} loading="lazy" decoding="async" className="hidden dark:block" />
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
          <h2 id="autres-produits" className="text-md font-semibold text-text">Le reste de la gamme Selio</h2>
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
