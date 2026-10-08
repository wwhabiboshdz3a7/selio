import { Boxes, ClipboardList, MessageSquare, Package, Radar, Settings, ShieldCheck, ShoppingCart, Users, Workflow } from "lucide-react";
import { usePageMeta } from "../../lib/seo";
import { AvailabilityBadge, CheckList, CtaBand, MarketingSection, type Availability } from "../components";

const MODULES: { icon: React.ReactNode; title: string; availability: Availability; lead: string; items: string[] }[] = [
  { icon: <Boxes />, title: "Articles et stock", availability: "available", lead: "Un inventaire conçu pour la revente, pas un catalogue générique.", items: ["Photos, marque, taille, catégorie, état", "Prix d'achat, frais, prix affiché et prix plancher", "Statuts stock, en vente, réservé, vendu, archivé avec transitions contrôlées", "Recherche, tri, filtres, pagination", "Import et export CSV avec prévisualisation ligne par ligne des erreurs", "Actions en lot avec confirmation, historique de modification"] },
  { icon: <MessageSquare />, title: "Messagerie et négociation", availability: "demo", lead: "Chaque conversation connaît l'article, son plancher et sa marge.", items: ["Recherche, filtres, non-lus", "Brouillons et suggestions de réponse", "Explication de la décision : accepter, contre-proposer, refuser, escalader", "Validation avant envoi par défaut", "Statut réel : brouillon, en attente, envoyé, échec", "Blocage clair si le connecteur ne permet pas l'envoi"] },
  { icon: <Users />, title: "Clients", availability: "available", lead: "Un CRM minimal : ce qu'il faut pour vendre, rien de plus.", items: ["Fiche client avec conversations et commandes liées", "Notes et tags", "Historique chronologique", "Déduplication par pseudo et fusion", "Données minimisées : aucune adresse ou email sans besoin"] },
  { icon: <Package />, title: "Commandes et expédition", availability: "available", lead: "Une commande = un article, un client, une marge figée.", items: ["Création sans doublon grâce à une clé d'idempotence", "Transitions contrôlées : en attente, payée, expédiée, livrée, terminée, annulée, remboursée", "Prix final, frais, marge brute", "Suivi d'expédition et document uniquement s'il est fourni par le connecteur", "Aucun faux bordereau : un document de démonstration est toujours marqué comme tel"] },
  { icon: <ClipboardList />, title: "Analyses", availability: "available", lead: "Des chiffres calculés depuis vos données, avec les conventions affichées.", items: ["Ventes, marge brute, panier moyen, rotation du stock", "Séries temporelles, ventilation par catégorie, canal et marque", "Filtres par période, catégorie et canal", "Export CSV", "La marge brute n'est jamais présentée comme un bénéfice net comptable"] },
  { icon: <Workflow />, title: "Automatisations", availability: "demo", lead: "Des règles explicites, une file de tâches visible et un bouton d'arrêt.", items: ["Règles avec horaires, limites par jour et par acheteur", "Validation humaine par défaut pour les actions sensibles", "File de tâches, historique d'exécution, nouvelle tentative maîtrisée", "Prévention des doublons par clé d'idempotence", "Pause par règle et arrêt global", "Indication claire de ce qui exige un navigateur ouvert"] },
  { icon: <Radar />, title: "Radar et opportunités", availability: "demo", lead: "Trouver des pièces à marge, en distinguant observé et estimé.", items: ["Recherches enregistrées avec critères, budget et marge cible", "Opportunités classées avec justification du score", "Estimation de revente basée sur vos ventes comparables", "Connecteur réel seulement si techniquement et contractuellement possible"] },
  { icon: <ShoppingCart />, title: "Achat assisté", availability: "demo", lead: "Préparer un achat avec des garde-fous, sans jamais improviser.", items: ["Budget, prix maximal, contrôles explicites", "Simulation de bout en bout", "Achat réel désactivé par défaut : confirmation explicite et connecteur autorisé requis", "Prévention des achats en double"] },
  { icon: <Settings />, title: "Paramètres", availability: "available", lead: "Organisation, rôles, connexions, IA, abonnement, sécurité, données.", items: ["Rôles propriétaire, administrateur, opérateur, lecture", "Connexions avec test, révocation, dernière synchronisation", "Export et suppression des données", "Statut des services"] },
  { icon: <ShieldCheck />, title: "Sécurité", availability: "available", lead: "Isolation par organisation et contrôles côté serveur.", items: ["Montants en centimes entiers, jamais de flottant monétaire", "Messages acheteurs traités comme données non fiables", "Secrets hors du navigateur et hors de Git", "Journal d'audit des actions sensibles"] },
];

export default function Features() {
  usePageMeta("Fonctionnalités", "Tous les modules de Selio : stock, messagerie, clients, commandes, analyses, automatisations, radar, achat assisté, paramètres et sécurité.");
  return (
    <>
      <MarketingSection level={1} eyebrow="Fonctionnalités" title="Un module par problème concret de revendeur" lead="Chaque module indique honnêtement son état : disponible, démontré en simulation, expérimental ou en préparation.">
        <div className="grid gap-4 md:grid-cols-2">
          {MODULES.map((m) => (
            <article key={m.title} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-text [&>svg]:size-5" aria-hidden>{m.icon}</span>
                  <h2 className="text-md font-semibold text-text">{m.title}</h2>
                </div>
                <AvailabilityBadge value={m.availability} />
              </div>
              <p className="mt-2 text-sm text-text-muted">{m.lead}</p>
              <div className="mt-4"><CheckList items={m.items} /></div>
            </article>
          ))}
        </div>
      </MarketingSection>
      <CtaBand title="Voyez les modules fonctionner ensemble" lead="La démonstration enchaîne le parcours complet avec des données fictives persistantes." />
    </>
  );
}
