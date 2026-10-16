import { MessageSquare, Package, ShoppingBag, Sparkles, TrendingUp } from "lucide-react";
import { usePageMeta } from "../../lib/seo";
import { CheckList, CtaBand, MarketingSection, PlannedList } from "../components";
import { ConstellationHero } from "../constellation/ConstellationHero";

const JOURNEY = [
  { icon: <ShoppingBag />, title: "Achat", text: "Le radar note chaque affaire sur 100 : vous validez en un clic, ou l'achat auto s'en charge au-dessus de votre seuil." },
  { icon: <Sparkles />, title: "Annonce", text: "Ajoutez vos photos : l'IA rédige l'annonce, le prix conseillé vient des ventes comparables. Le plancher protège votre marge." },
  { icon: <MessageSquare />, title: "Conversation", text: "Chaque message est rattaché au client et à l'article. L'assistant propose une réponse, vous validez." },
  { icon: <Package />, title: "Commande", text: "La vente crée une commande sans doublon, suit l'expédition et fige le coût d'acquisition." },
  { icon: <TrendingUp />, title: "Marge", text: "CA, marge brute, panier moyen et rotation calculés depuis vos données réelles, avec les formules affichées." },
];

export default function Home() {
  usePageMeta("Selio — Gestion pour revendeurs Vinted", "Stock, conversations, clients, commandes et marges des revendeurs Vinted au même endroit. Règles de marge, assistant de rédaction, automatisations transparentes.");
  return (
    <>
      <ConstellationHero />

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
