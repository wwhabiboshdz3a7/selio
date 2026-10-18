import { Link } from "react-router";
import { ArrowRight, MessageSquare, Package, ShoppingBag, Sparkles, TrendingUp } from "lucide-react";
import { usePageMeta } from "../../lib/seo";
import { CheckList, Container, CtaBand, Eyebrow, Lead, MarketingSection, PlannedList } from "../components";
import { ConstellationHero } from "../constellation/ConstellationHero";
import { SPACES, SpaceShowcaseCard } from "../spaces";
import apercuClair from "../assets/apercu-clair.webp";
import apercuSombre from "../assets/apercu-sombre.webp";

const JOURNEY = [
  { icon: <ShoppingBag />, title: "Achat", text: "Le radar note chaque affaire sur 100 : vous validez en un clic, ou l'achat auto s'en charge au-dessus de votre seuil." },
  { icon: <Sparkles />, title: "Annonce", text: "Ajoutez vos photos : l'IA rédige l'annonce, le prix conseillé vient des ventes comparables. Le plancher protège votre marge." },
  { icon: <MessageSquare />, title: "Conversation", text: "Chaque message est rattaché au client et à l'article. L'assistant propose une réponse, vous validez." },
  { icon: <Package />, title: "Commande", text: "La vente crée une commande sans doublon, suit l'expédition et fige le coût d'acquisition." },
  { icon: <TrendingUp />, title: "Marge", text: "CA, marge brute, panier moyen et rotation calculés depuis vos données réelles, avec les formules affichées." },
];

const SHOT_ALT = "Dressing intelligent de la démonstration Selio : vraies annonces Vinted en photo, note sur 100 au-dessus de chaque annonce, ancienneté en ligne et republications conseillées (statistiques fictives).";

/**
 * Le produit réel, juste après la visite : le dressing intelligent de la démonstration
 * (capture locale, vraies photos d'annonces, statistiques fictives) sort du ciel nocturne dans un cadre incliné
 * qui se redresse au défilement (CSS, sans JS), entouré de l'anneau d'or.
 */
function ProductShowcase() {
  return (
    <section id="application" className="mk-showcase scroll-mt-14" aria-labelledby="application-titre">
      <Container>
        <div className="mk-showcase-stage">
          <span className="mk-orbit mk-orbit-back" aria-hidden="true" />
          <figure className="mk-shot">
            <div className="mk-shot-bar" aria-hidden="true"><i /><i /><i /><span>Selio · dressing intelligent</span></div>
            <img src={apercuClair} alt={SHOT_ALT} width={1600} height={1000} loading="lazy" decoding="async" className="mk-shot-img dark:hidden" />
            <img src={apercuSombre} alt={SHOT_ALT} width={1600} height={1000} loading="lazy" decoding="async" className="mk-shot-img hidden dark:block" />
          </figure>
          <span className="mk-orbit mk-orbit-front" aria-hidden="true">
            <span className="mk-orbit-path"><span className="mk-orbit-arm"><span className="mk-orbit-star" /></span></span>
          </span>
        </div>
        <p className="mt-4 text-center text-xs text-text-muted">Capture réelle de la démonstration : vraies annonces Vinted, statistiques fictives.</p>
        <div className="mx-auto mt-10 max-w-2xl text-center md:mt-12">
          <Eyebrow>L'application</Eyebrow>
          <h2 id="application-titre" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Chaque annonce notée, chaque republication prête</h2>
          <Lead className="mt-3">Vos annonces en ligne, notées sur 100 avec ce qu'il faut améliorer, triées par ancienneté pour savoir quoi republier, et dix variantes déjà écrites pour chacune.</Lead>
          <p className="mt-5">
            <Link to="/demo?vers=/app/dressing" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Ouvrir le dressing dans la démo <ArrowRight className="size-4" aria-hidden /></Link>
          </p>
        </div>
      </Container>
    </section>
  );
}

export default function Home() {
  usePageMeta("Selio — Gestion pour revendeurs Vinted", "Stock, conversations, clients, commandes et marges des revendeurs Vinted au même endroit. Règles de marge, assistant de rédaction, automatisations transparentes.");
  return (
    <>
      <ConstellationHero />
      <ProductShowcase />

      <MarketingSection id="parcours" reveal className="scroll-mt-14" eyebrow="Le parcours" title="De l'achat à la marge, sans rien ressaisir" lead="Chaque étape alimente la suivante. Le prix d'achat saisi au départ se retrouve dans la négociation, puis dans la marge de la commande.">
        <ol className="cst-path grid gap-8 md:grid-cols-5 md:gap-6">
          {JOURNEY.map((s, i) => (
            <li key={s.title} className="cst-path-step" data-reveal="">
              <span className="cst-path-node" aria-hidden>{s.icon}</span>
              <p className="num mt-0 text-xs font-medium tracking-[0.06em] text-text-muted uppercase md:mt-5">Étape {i + 1}</p>
              <h3 className="mt-1 text-md font-semibold text-text">{s.title}</h3>
              <p className="mt-1.5 text-sm text-text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </MarketingSection>

      <MarketingSection reveal id="espaces" className="scroll-mt-14 border-t border-border" eyebrow="Une plateforme, puis des filiales" title="Quatre espaces, une seule IA" lead="Selio gère votre activité au quotidien. Sur ses données, trois espaces s'ajoutent : Studio écrit les annonces, Agence met l'outil à vos couleurs, Global prépare les autres pays.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SPACES.map((s) => <SpaceShowcaseCard key={s.id} space={s} compact />)}
        </div>
        <p className="mt-6">
          <Link to="/plateforme" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Pourquoi cet ordre, et ce qui est prêt <ArrowRight className="size-4" aria-hidden /></Link>
        </p>
      </MarketingSection>

      <MarketingSection reveal eyebrow="Transparence" title="Ce qui est disponible aujourd'hui, et ce qui ne l'est pas encore" className="border-t border-border bg-surface">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-bg p-6" data-reveal="">
            <h3 className="text-md font-semibold text-text">Disponible maintenant</h3>
            <div className="mt-4">
              <CheckList items={["Gestion du stock, des clients, des commandes et des analyses", "Règles de marge et politique de négociation déterministe", "Messagerie avec brouillons et suggestions de réponse validées par vos règles", "Automatisations avec file de tâches, historique, pause et arrêt global", "Mode démonstration complet, données fictives et réinitialisables", "Modes clair et sombre, application installable (PWA)"]} />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-bg p-6" data-reveal="">
            <h3 className="text-md font-semibold text-text">En préparation ou à valider</h3>
            <div className="mt-4">
              <PlannedList items={["Lecture et envoi via l'extension sur le site Vinted : construit sur des fixtures, à valider dans un navigateur réel", "Assistant IA sur mon modèle perso, hébergé sur un serveur dédié : intégration prête, matériel à raccorder", "Achat réel (à valider et achat auto) : désactivé, simulation de bout en bout disponible", "Abonnements : adaptateur de paiement en mode test uniquement", "Vinted ne propose pas d'API publique pour les vendeurs : Selio ne promet aucune compatibilité officielle"]} />
            </div>
          </div>
        </div>
      </MarketingSection>

      <CtaBand seed={3} title="Essayez le parcours complet en quelques minutes" lead="Créez un article, retrouvez sa conversation, générez une réponse, créez la commande et retrouvez la marge dans les analyses." />
    </>
  );
}
