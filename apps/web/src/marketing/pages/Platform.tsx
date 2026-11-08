import { Link } from "react-router";
import { Container, CtaBand, Eyebrow, IndependenceNotice, MarketingSection, NightSky } from "../components";
import { PRODUCTS } from "../products";
import { useMarketingMeta } from "../seo";
import { SPACES, SpaceShowcaseCard, SpacesConstellation } from "../spaces";

const WHY = [
  { title: "L'outil de gestion crée l'habitude", text: "Le stock, les messages et les ventes passent par Selio chaque jour. C'est l'outil dont un revendeur a besoin en premier." },
  { title: "Chaque vente apprend quelque chose", text: "Ce qui part, à quel prix, en combien de temps, avec quel titre et combien de photos : vos propres données, calculées pour vous." },
  { title: "Les filiales s'en servent", text: "Studio écrit les annonces à partir de ce qui marche, Track montre où sourcer, Agents organise l'équipe, Comptes aide à ouvrir une boutique ; Cloud arrive, sans rien ressaisir." },
];

export default function Platform() {
  useMarketingMeta("/plateforme");
  return (
    <>
      <MarketingSection level={1} reveal eyebrow="La plateforme" title="Une plateforme, puis des filiales" lead="D'abord l'outil de gestion des revendeurs. Ensuite, sur la même IA et les mêmes données, des filiales spécialisées : écrire les annonces, travailler en équipe, savoir où sourcer, vendre ordinateur éteint, ouvrir un nouveau compte.">
        <div className="mk-night hidden px-6 py-8 md:block md:px-10">
          <NightSky seed={11} lines={false} />
          <SpacesConstellation />
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SPACES.map((s) => <SpaceShowcaseCard key={s.id} space={s} />)}
        </div>
        <p className="mt-4 text-sm text-text-muted">Un seul compte pour Selio et ses filiales. Celles qui sont en aperçu ou en développement ne sont ni activées ni facturées ; aucune date n'est promise.</p>
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
          <nav aria-label="Pages des filiales" className="mt-6">
            <ul className="flex flex-wrap gap-2">
              {PRODUCTS.map((p) => (
                <li key={p.slug}><Link to={p.path} className="inline-flex h-9 items-center rounded-full border border-border bg-bg px-4 text-sm font-medium text-text hover:text-accent">{p.name}</Link></li>
              ))}
            </ul>
          </nav>
          <IndependenceNotice className="mt-6 max-w-3xl text-sm" />
        </Container>
      </section>

      <CtaBand seed={5} title="Selio et ses filiales sont dans la démonstration" lead="Ouvrez la démo : l'accueil central présente Selio, Studio, Agents, Track, Cloud et Comptes, avec des données fictives." />
    </>
  );
}
