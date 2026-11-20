import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Camera, Handshake, MessageSquare, RefreshCw, ShoppingBag, Tag, TrendingUp } from "lucide-react";
import { TRIAL_DAYS } from "@selio/contracts";
import { faqPageJsonLd, seoPage, softwareApplicationJsonLd, useMarketingMeta } from "../seo";
import { CheckList, Container, CtaBand, Eyebrow, FaqList, JsonLd, Lead, MarketingSection, PlannedList, ShotPicture } from "../components";
import { ConstellationHero } from "../constellation/ConstellationHero";
import { RANGE, RangeCard } from "../spaces";
import { MANAGER_SHOT } from "../productShots";
import { OBJECTIONS } from "../objections";

/** Les questions qui freinent avant l'essai, en bas de l'accueil (et en FAQPage). */
const HOME_OBJECTIONS = OBJECTIONS.filter((o) => ["carte-essai", "resiliation", "mot-de-passe", "risque-compte", "donnees-france"].includes(o.id));

/**
 * Le parcours, de l'achat à l'étiquette : chaque étape nomme la filiale Selio qui s'en charge
 * (Track analyse, Bot recherche et achète, Studio crée l'annonce, Manager vend, expédie et suit).
 * Les fournisseurs partenaires sont une possibilité annoncée comme telle : aucun accord n'est
 * signé, aucun nom ni logo n'est cité.
 */
const JOURNEY: { icon: ReactNode; title: string; product: string; text: string; soon?: boolean }[] = [
  { icon: <TrendingUp />, title: "Sourcing et analyse", product: "Selio Track", text: "Où sourcer et à quel prix revendre : niches, suivi du marché, produits similaires et prix de revente estimés. Track analyse ; il n'achète pas." },
  { icon: <Handshake />, title: "Sourcing auprès de fournisseurs partenaires", product: "Bientôt", soon: true, text: "Grossistes, friperies et lots : des fournisseurs sélectionnés, proposés depuis Selio. Aucun partenariat n'est encore signé." },
  { icon: <ShoppingBag />, title: "Recherche et achat", product: "Selio Bot", text: "Vos critères surveillés, chaque affaire notée sur 100 avec sa marge possible, alerte puis achat en un clic ; le prix d'achat suit l'article jusqu'à la marge." },
  { icon: <Camera />, title: "Photos et annonce", product: "Selio Studio", text: "Vos photos deviennent une annonce : titre optimisé, description détaillée, étiquette lue, questions posées s'il manque une valeur." },
  { icon: <MessageSquare />, title: "Vente, négociation et relances", product: "Selio Manager", text: "Réponses, contre-offres et relances selon votre prix plancher et vos horaires ; avec Selio Cloud, certaines continuent ordinateur éteint." },
  { icon: <Tag />, title: "Commande, étiquette et envoi", product: "Selio Manager", text: "La vente crée une commande sans doublon et fige la marge ; le bordereau est commandé dès la vente. Jamais de faux bordereau." },
  { icon: <RefreshCw />, title: "Après-vente", product: "Selio Manager", text: "Messages après la vente et à la livraison, puis le stock repart : les annonces qui stagnent ont leur republication prête." },
];

const SHOT_ALT = "Dressing intelligent de Selio Manager : vraies photos d'annonces Vinted, note sur 100 au-dessus de chaque annonce, ancienneté en ligne et republications conseillées (statistiques d'exemple).";

/** Article suivi d'une étape à l'autre (vraie photo d'annonce, remise à l'endroit). */
const FOLLOWED_ITEM = { photo: "/demo/photos/g-x4iv-1.webp", title: "Pull torsadé gris et écru, taille XL" };

/**
 * Le produit réel, juste après la visite : le dressing intelligent de Selio Manager
 * (capture locale, vraies photos d'annonces, statistiques d'exemple) sort du ciel nocturne dans un cadre incliné
 * qui se redresse au défilement (CSS, sans JS), entouré de l'anneau d'or.
 */
function ProductShowcase() {
  return (
    <section id="application" className="mk-showcase scroll-mt-14" aria-labelledby="application-titre">
      <Container>
        <div className="mk-showcase-stage">
          <span className="mk-orbit mk-orbit-back" aria-hidden="true" />
          <figure className="mk-shot">
            <div className="mk-shot-bar" aria-hidden="true"><i /><i /><i /><span>Selio Manager · dressing intelligent</span></div>
            <ShotPicture src={MANAGER_SHOT.light} alt={SHOT_ALT} sizes="(min-width: 1280px) 1100px, calc(100vw - 32px)" className="block dark:hidden" imgClassName="mk-shot-img" />
            <ShotPicture src={MANAGER_SHOT.dark} alt={SHOT_ALT} sizes="(min-width: 1280px) 1100px, calc(100vw - 32px)" className="hidden dark:block" imgClassName="mk-shot-img" />
          </figure>
          <span className="mk-orbit mk-orbit-front" aria-hidden="true">
            <span className="mk-orbit-path"><span className="mk-orbit-arm"><span className="mk-orbit-star" /></span></span>
          </span>
        </div>
        <p className="mt-4 text-center text-xs text-text-muted">Capture d'écran de Selio Manager : vraies photos d'annonces Vinted, statistiques d'exemple.</p>
        <div className="mx-auto mt-10 max-w-2xl text-center md:mt-12">
          <Eyebrow>Selio Manager</Eyebrow>
          <h2 id="application-titre" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Chaque annonce notée, chaque republication prête</h2>
          <Lead className="mt-3">Vos annonces en ligne, notées sur 100 avec ce qu'il faut améliorer, triées par ancienneté pour savoir quoi republier, et dix variantes déjà écrites pour chacune.</Lead>
          <p className="mt-5">
            <Link to="/produits/manager" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Découvrir Selio Manager <ArrowRight className="size-4" aria-hidden /></Link>
          </p>
        </div>
      </Container>
    </section>
  );
}

export default function Home() {
  useMarketingMeta("/");
  return (
    <>
      <JsonLd data={[softwareApplicationJsonLd({ name: "Selio Manager", path: "/", description: seoPage("/").description, offers: true }), faqPageJsonLd(HOME_OBJECTIONS)]} />
      <ConstellationHero />
      <ProductShowcase />

      <MarketingSection id="parcours" reveal className="scroll-mt-14" eyebrow="Le parcours" title="De l'achat à l'étiquette, sans rien ressaisir" lead="Du sourcing à l'après-vente, chaque étape alimente la suivante : le prix d'achat saisi au départ se retrouve dans la négociation, puis dans la marge de la commande.">
        <figure className="mb-10 flex items-center gap-4 rounded-xl border border-border bg-surface p-3 pr-5 sm:inline-flex" data-reveal="">
          <img src={FOLLOWED_ITEM.photo} alt={FOLLOWED_ITEM.title} width={64} height={85} loading="lazy" decoding="async" className="h-[85px] w-16 shrink-0 rounded-md object-cover" />
          <figcaption className="text-sm text-text-muted">
            <span className="block font-medium text-text">Un article, sept étapes</span>
            Exemple : {FOLLOWED_ITEM.title.charAt(0).toLowerCase() + FOLLOWED_ITEM.title.slice(1)}, de son sourcing à son bordereau.
          </figcaption>
        </figure>
        <ol className="cst-path cst-path-grid grid gap-8 md:grid-cols-2 md:gap-x-6 md:gap-y-10 lg:grid-cols-4">
          {JOURNEY.map((s, i) => (
            <li key={s.title} className="cst-path-step" data-reveal="" data-soon={s.soon ? "" : undefined}>
              <span className="cst-path-node" aria-hidden>{s.icon}</span>
              <p className="num mt-0 text-xs font-medium tracking-[0.06em] text-text-muted uppercase md:mt-5">Étape {i + 1}</p>
              <h3 className="mt-1 text-md font-semibold text-text">{s.title}</h3>
              <p className={s.soon ? "mt-1 text-xs font-medium tracking-[0.02em] text-text-muted" : "mt-1 text-xs font-medium tracking-[0.02em] text-accent"}>{s.product}</p>
              <p className="mt-1.5 text-sm text-text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-xs text-text-muted">Fournisseurs partenaires : une piste annoncée, pas une offre. Aucun accord n'est signé à ce jour ; vous serez prévenu quand ce sera le cas.</p>
      </MarketingSection>

      <MarketingSection reveal id="espaces" className="scroll-mt-14 border-t border-border" eyebrow="Les filiales Selio" title="Cinq filiales, un seul compte" lead="Selio Manager centralise la gestion et l'automatisation de votre activité Vinted. Selio Cloud et Selio Agent, ses fonctionnalités intégrées, complètent ses possibilités. Autour : Selio Studio crée vos annonces, Selio Track analyse le marché, Selio Bot recherche et achète, Selio Compte s'occupe de vos comptes et vous accompagne.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {RANGE.map((p) => <RangeCard key={p.slug} product={p} compact />)}
        </div>
        <p className="mt-6">
          <Link to="/plateforme" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Les cinq filiales, et ce qui est prêt <ArrowRight className="size-4" aria-hidden /></Link>
        </p>
      </MarketingSection>

      <MarketingSection reveal eyebrow="Transparence" title="Ce qui est disponible aujourd'hui, et ce qui ne l'est pas encore" className="border-t border-border bg-surface">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-bg p-6" data-reveal="">
            <h3 className="text-md font-semibold text-text">Disponible maintenant</h3>
            <div className="mt-4">
              <CheckList items={["Gestion du stock, des clients, des commandes et des analyses", "Règles de marge et politique de négociation déterministe", "Messagerie avec brouillons et suggestions de réponse validées par vos règles", "Onglet Automatisation : messages aux favoris, réponse et négociation automatiques, après-vente, bordereaux et stock automatique", "Selio Compte : prestations sur demande (configuration, accompagnement), commandées depuis la page Contact", "Modes clair et sombre, application installable (PWA)"]} />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-bg p-6" data-reveal="">
            <h3 className="text-md font-semibold text-text">En préparation ou à valider</h3>
            <div className="mt-4">
              <PlannedList items={["Lecture et envoi via l'extension sur le site Vinted : construit sur des fixtures, à valider dans un navigateur réel", "Selio Cloud (fonctionnalité de Selio Manager) et la lecture en direct de Selio Bot : construits et testés sur des pages locales, jamais encore exécutés contre Vinted", "Assistant IA sur mon modèle perso, hébergé sur un serveur dédié : intégration prête, matériel à raccorder", "Achat réel par Selio Bot (rapide ou automatique) : désactivé tant qu'aucun connecteur d'achat n'est autorisé", "Fournisseurs partenaires : aucun accord signé", "API officielle Vinted Pro Integrations : réservée aux comptes Pro admis par Vinted ; accès à demander, connecteur Selio en préparation. Ailleurs, aucune compatibilité officielle n'est promise"]} />
            </div>
          </div>
        </div>
      </MarketingSection>

      <section className="border-t border-border py-12 md:py-16" aria-labelledby="avant-essai">
        <Container className="max-w-3xl">
          <Eyebrow>Avant d'essayer</Eyebrow>
          <h2 id="avant-essai" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Les questions qu'on nous pose avant de commencer</h2>
          <FaqList className="mt-6" items={HOME_OBJECTIONS} />
          <p className="mt-6">
            <Link to="/faq" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Toutes les questions fréquentes <ArrowRight className="size-4" aria-hidden /></Link>
          </p>
        </Container>
      </section>

      <CtaBand seed={3} title={`Essayez Selio sur votre propre activité pendant ${TRIAL_DAYS} jours`} lead="Toutes les fonctions du plan Pro, rien n'est débité avant la fin de l'essai. Résiliable à tout moment." />
    </>
  );
}
