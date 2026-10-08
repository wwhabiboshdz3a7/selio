import { Link } from "react-router";
import { ArrowRight, Boxes, MessageSquare, Package, Radar, ShoppingBag, TrendingUp, Workflow } from "lucide-react";
import { Button } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { CheckList, Container, CtaBand, Display, Eyebrow, FeatureCard, Lead, MarketingSection, PlannedList, ProductPreview } from "../components";

const JOURNEY = [
  { icon: <ShoppingBag />, title: "Achat", text: "Repérez une pièce avec le Radar, fixez un budget et une marge cible avant d'acheter." },
  { icon: <Boxes />, title: "Stock", text: "Enregistrez prix d'achat, frais et prix plancher. Le plancher protège votre marge à chaque négociation." },
  { icon: <MessageSquare />, title: "Conversation", text: "Chaque message est rattaché au client et à l'article. L'assistant propose une réponse, vous validez." },
  { icon: <Package />, title: "Commande", text: "La vente crée une commande sans doublon, suit l'expédition et fige le coût d'acquisition." },
  { icon: <TrendingUp />, title: "Marge", text: "CA, marge brute, panier moyen et rotation calculés depuis vos données réelles, avec les formules affichées." },
];

export default function Home() {
  usePageMeta("Selio — Gestion pour revendeurs Vinted", "Stock, conversations, clients, commandes et marges des revendeurs Vinted au même endroit. Règles de marge, assistant de rédaction, automatisations transparentes.");
  return (
    <>
      <section className="border-b border-border bg-surface">
        <Container className="grid gap-10 py-14 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-center md:py-20">
          <div>
            <Eyebrow>Pour les revendeurs qui tiennent leurs comptes</Eyebrow>
            <Display className="mt-3">Vos articles, vos conversations et votre marge, au même endroit.</Display>
            <Lead className="mt-4">Selio est l'outil de gestion des revendeurs : un stock avec prix plancher, une messagerie reliée aux clients et aux commandes, des analyses honnêtes, et des automatisations que vous contrôlez.</Lead>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/inscription"><Button variant="accent" size="lg" iconRight={<ArrowRight />}>Créer un compte</Button></Link>
              <Link to="/demo"><Button variant="secondary" size="lg">Explorer la démo</Button></Link>
            </div>
            <p className="mt-4 text-xs text-text-muted">La démonstration fonctionne sans compte ni carte bancaire, avec des données fictives.</p>
          </div>
          <ProductPreview />
        </Container>
      </section>

      <MarketingSection eyebrow="Le parcours" title="De l'achat à la marge, sans rien ressaisir" lead="Chaque étape alimente la suivante. Le prix d'achat saisi au départ se retrouve dans la négociation, puis dans la marge de la commande.">
        <ol className="grid gap-4 md:grid-cols-5">
          {JOURNEY.map((s, i) => (
            <li key={s.title} className="card p-5">
              <div className="flex items-center justify-between">
                <span className="text-text [&>svg]:size-5" aria-hidden>{s.icon}</span>
                <span className="num text-xs text-text-muted">{i + 1}/5</span>
              </div>
              <h3 className="mt-3 text-md font-semibold text-text">{s.title}</h3>
              <p className="mt-1 text-sm text-text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </MarketingSection>

      <MarketingSection eyebrow="Ce que vous obtenez" title="Un outil de travail, pas un tableau de bord décoratif" className="border-t border-border bg-surface">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<Boxes />} title="Stock et prix plancher" availability="available">Création, import CSV avec prévisualisation des erreurs, actions en lot, historique de modification. Le plancher est calculé depuis vos règles de marge.</FeatureCard>
          <FeatureCard icon={<MessageSquare />} title="Messagerie et négociation" availability="demo">Brouillons, suggestions de réponse, explication de chaque acceptation ou refus. Validation avant envoi par défaut, statut réel du message.</FeatureCard>
          <FeatureCard icon={<Workflow />} title="Automatisations contrôlées" availability="demo">Règles avec horaires, limites par jour et par acheteur, file de tâches visible, pause par règle et arrêt global.</FeatureCard>
          <FeatureCard icon={<TrendingUp />} title="Analyses avec formules" availability="available">CA, marge brute, panier moyen, rotation du stock. Les conventions de calcul sont affichées, l'export CSV aussi.</FeatureCard>
          <FeatureCard icon={<Radar />} title="Radar d'opportunités" availability="demo">Recherches enregistrées, opportunités classées avec justification, séparation claire entre ce qui est observé et ce qui est estimé.</FeatureCard>
          <FeatureCard icon={<Package />} title="Extension navigateur" availability="experimental">Capture d'un article visible vers le stock et aide à la rédaction depuis une conversation ouverte. Adaptateurs à valider sur le site réel.</FeatureCard>
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Transparence" title="Ce qui est disponible aujourd'hui, et ce qui ne l'est pas encore">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="card p-5">
            <h3 className="text-md font-semibold text-text">Disponible maintenant</h3>
            <div className="mt-4">
              <CheckList items={["Gestion du stock, des clients, des commandes et des analyses", "Règles de marge et politique de négociation déterministe", "Messagerie avec brouillons et suggestions de réponse validées par vos règles", "Automatisations avec file de tâches, historique, pause et arrêt global", "Mode démonstration complet, données fictives et réinitialisables", "Modes clair et sombre, application installable (PWA)"]} />
            </div>
          </div>
          <div className="card p-5">
            <h3 className="text-md font-semibold text-text">En préparation ou à valider</h3>
            <div className="mt-4">
              <PlannedList items={["Lecture et envoi via l'extension sur le site Vinted : construit sur des fixtures, à valider dans un navigateur réel", "Assistant IA sur serveur Ollama dédié : intégration prête, matériel à raccorder", "Achat assisté réel : désactivé par défaut, simulation de bout en bout disponible", "Abonnements : adaptateur de paiement en mode test uniquement", "Vinted ne propose pas d'API publique pour les vendeurs : Selio ne promet aucune compatibilité officielle"]} />
            </div>
          </div>
        </div>
      </MarketingSection>

      <CtaBand title="Essayez le parcours complet en quelques minutes" lead="Créez un article, retrouvez sa conversation, générez une réponse, créez la commande et retrouvez la marge dans les analyses." />
    </>
  );
}
