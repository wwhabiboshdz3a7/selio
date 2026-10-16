import { usePageMeta } from "../../lib/seo";
import { CtaBand, MarketingSection } from "../components";

const FAQ: { q: string; a: string }[] = [
  { q: "Selio est-il affilié à Vinted ?", a: "Non. Selio est un outil indépendant. Vinted ne propose pas d'API publique pour les vendeurs ; Selio ne promet aucune compatibilité officielle et n'utilise pas de faux OAuth." },
  { q: "Comment l'extension accède-t-elle à mes conversations ?", a: "Elle lit uniquement la page que vous avez ouverte dans votre navigateur, où vous êtes déjà connecté. Elle ne stocke jamais votre mot de passe ni vos cookies. Les adaptateurs de page sont pour l'instant construits sur des fixtures et doivent être validés en conditions réelles." },
  { q: "Les messages partent-ils automatiquement ?", a: "Par défaut, non : chaque brouillon est validé par vous. Une règle d'automatisation peut être configurée pour certaines actions, avec horaires, limites et possibilité d'arrêt global. Un message n'est jamais affiché « envoyé » avant confirmation du connecteur." },
  { q: "Que fait l'IA exactement ?", a: "Elle rédige. La décision commerciale (accepter, contre-proposer, refuser, escalader) est prise par une politique déterministe à partir de votre prix plancher, de votre marge minimale, de vos horaires et de vos limites. La réponse de l'IA est ensuite vérifiée par un schéma et par ces règles." },
  { q: "Comment la marge est-elle calculée ?", a: "Marge brute = prix de vente − frais plateforme vendeur − port à charge du vendeur − autres coûts − (prix d'achat + frais d'acquisition). Tous les montants sont des centimes entiers. Ce n'est pas un bénéfice net comptable." },
  { q: "Que contient la démonstration ?", a: "Un jeu de données fictif et cohérent (articles, clients, conversations, commandes, règles, opportunités) persistant dans votre navigateur, réinitialisable. Toute action externe y est simulée et signalée comme telle." },
  { q: "Où sont stockées mes données en mode connecté ?", a: "Dans une base PostgreSQL isolée par organisation, avec contrôle d'accès côté serveur et politiques de sécurité par ligne. Les secrets de connexion sont chiffrés avec une clé qui n'est pas dans la base. Vous pouvez exporter et supprimer vos données à tout moment." },
  { q: "Puis-je acheter automatiquement les bonnes affaires ?", a: "L'achat auto existe avec des garde-fous (seuil de note réglable, plafond par jour, prix maximal par article, délai d'annulation), mais il est aujourd'hui simulé de bout en bout : l'achat réel exigerait un connecteur autorisé, qui n'existe pas. Rien n'est jamais payé à votre insu." },
  { q: "Comment l'IA note-t-elle une affaire ?", a: "Sur 100 : marge estimée (40 pts, port et protection acheteurs inclus), taux de marge (15), état et photos (15), marque et demande prouvée par des ventes comparables (15), fiabilité du vendeur (10), port et fraîcheur de l'annonce (5). 75 et plus : à valider ; 85 et plus : seuil conseillé pour l'achat auto." },
  { q: "Le générateur d'annonces publie-t-il à ma place ?", a: "Seulement si vous cliquez sur « Publier directement ». Sinon l'annonce est enregistrée en brouillon. L'IA rédige le texte à partir des photos ; le prix conseillé est calculé sur les ventes comparables." },
  { q: "L'application fonctionne-t-elle sur mobile ?", a: "Oui : interface responsive dès 375 px et application installable (PWA) en modes clair et sombre." },
];

export default function Faq() {
  usePageMeta("FAQ", "Questions fréquentes sur Selio : indépendance vis-à-vis de Vinted, extension, automatisations, IA, calcul de marge, données et démonstration.");
  return (
    <>
      <MarketingSection level={1} eyebrow="FAQ" title="Questions fréquentes">
        <dl className="grid gap-3 md:grid-cols-2">
          {FAQ.map((f) => (
            <div key={f.q} className="card p-5">
              <dt className="text-md font-semibold text-text">{f.q}</dt>
              <dd className="mt-2 text-sm text-text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </MarketingSection>
      <CtaBand title="Une question précise ?" lead="Écrivez-nous depuis la page Contact ou explorez la démonstration pour vérifier par vous-même." />
    </>
  );
}
