import { Link } from "react-router";
import { TRIAL_DAYS } from "@selio/contracts";
import { Container, CtaBand, Eyebrow, IndependenceNotice, MarketingSection, NightSky } from "../components";
import { PRODUCTS } from "../products";
import { useMarketingMeta } from "../seo";
import { RANGE, RangeCard, RangeConstellation } from "../spaces";

const WHY = [
  { title: "Selio Manager crée l'habitude", text: "Le stock, les messages, les ventes et les étiquettes passent par Selio Manager chaque jour. C'est l'outil dont un revendeur a besoin en premier." },
  { title: "Chaque vente apprend quelque chose", text: "Ce qui part, à quel prix, en combien de temps, avec quel titre et combien de photos : vos propres données, calculées pour vous." },
  { title: "Le reste de la gamme s'en sert", text: "Studio écrit les annonces à partir de ce qui marche, Track et Radar montrent où sourcer, Selio Bot automatise la vente dans Selio Cloud, Agents organise l'équipe, Selio Comptes met en place la boutique." },
];

export default function Platform() {
  useMarketingMeta("/plateforme");
  return (
    <>
      <MarketingSection level={1} reveal eyebrow="La gamme Selio" title="Une plateforme, puis des filiales" lead="D'abord Selio Manager, l'outil de gestion des revendeurs. Ensuite, sur la même IA et les mêmes données : écrire les annonces, savoir où sourcer, repérer les bonnes affaires, automatiser la vente, la faire tourner ordinateur éteint, travailler en équipe, mettre en place une boutique.">
        <div className="mk-night hidden px-6 py-8 md:block md:px-10">
          <NightSky seed={11} lines={false} />
          <RangeConstellation />
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {RANGE.map((p) => <RangeCard key={p.slug} product={p} />)}
        </div>
        <p className="mt-4 text-sm text-text-muted">Un seul compte pour toute la gamme. Ce qui est en aperçu ou en développement n'est ni activé ni facturé ; aucune date n'est promise.</p>
      </MarketingSection>

      <section className="border-t border-border bg-surface py-12 md:py-16">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Pourquoi cet ordre</Eyebrow>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">D'abord l'outil de gestion, ensuite les filiales</h2>
          </div>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {WHY.map((w, i) => (
              <li key={w.title} className="rounded-xl border border-border bg-bg p-5" data-reveal="">
                <p className="num text-xs font-medium tracking-[0.06em] text-text-muted uppercase">Étape {i + 1}</p>
                <h3 className="mt-1 text-md font-semibold text-text">{w.title}</h3>
                <p className="mt-1.5 text-sm text-text-muted">{w.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-3xl text-sm text-text-muted">Vos données restent celles de votre organisation : elles alimentent vos propres analyses.</p>
          <nav aria-label="Pages de la gamme" className="mt-6">
            <ul className="flex flex-wrap gap-2">
              {PRODUCTS.map((p) => (
                <li key={p.slug}><Link to={p.path} className="inline-flex h-9 items-center rounded-full border border-border bg-bg px-4 text-sm font-medium text-text hover:text-accent">{p.name}</Link></li>
              ))}
            </ul>
          </nav>
          <IndependenceNotice className="mt-6 max-w-3xl text-sm" />
        </Container>
      </section>

      <CtaBand seed={5} title="Toute la gamme, un seul compte" lead={`L'essai de ${TRIAL_DAYS} jours ouvre Selio Manager et les filiales comprises dans le plan Pro. Rien n'est débité avant la fin de l'essai.`} />
    </>
  );
}
