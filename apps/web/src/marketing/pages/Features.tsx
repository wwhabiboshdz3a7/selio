import { Bot, Boxes, ClipboardList, MessageSquare, Package, Radar, Settings, ShieldCheck, Shirt, ShoppingCart, Sparkles, TrendingUp, Users, Workflow } from "lucide-react";
import { usePageMeta } from "../../lib/seo";
import { AvailabilityBadge, CheckList, CtaBand, MarketingSection, type Availability } from "../components";

/** Modules « signature » : étoile d'or dans la constellation. */
const GOLD = new Set(["generateur", "bonnes-affaires"]);

const MODULES: { id: string; icon: React.ReactNode; title: string; availability: Availability; lead: string; items: string[] }[] = [
  { icon: <Sparkles />, id: "generateur", title: "Générateur d'annonces", availability: "demo", lead: "Vous ajoutez les photos, l'IA rédige l'annonce. Notre grande différence.", items: ["Photos glissées-déposées ou prises au téléphone, compressées dans le navigateur", "Titre, description, marque, catégorie, taille, état, couleurs, matière", "Prix conseillé calculé sur les ventes comparables (jamais inventé par l'IA)", "Choix du compte Vinted, puis brouillon ou publication directe", "Modèle IA personnel (Ollama + modèle de vision) prêt à brancher"] },
  { icon: <Shirt />, id: "dressing", title: "Dressing intelligent", availability: "demo", lead: "Chaque annonce en ligne notée sur 100, avec ce qu'il faut améliorer.", items: ["Note : visibilité, attractivité, qualité de l'annonce, prix face au marché", "Tri « en ligne depuis 7 jours ou plus » pour savoir quoi republier", "10 republications pré-faites par annonce (minimum 8) : titre, description, prix, couverture, créneau", "Suivi des variantes déjà utilisées et de leur rendement à 48 h"] },
  { icon: <TrendingUp />, id: "revendeurs", title: "Analyse des revendeurs", availability: "demo", lead: "Qui vend le plus, quoi, à quel prix : repérez les niches qui marchent.", items: ["Classement des grands revendeurs par chiffre d'affaires estimé", "Niche principale de chaque vendeur, marques, catégories, rotation, tendance", "Niches à forte demande et faible concurrence", "Calculé sur les annonces observées par le radar et l'extension"] },
  { icon: <Boxes />, id: "stock", title: "Articles et stock", availability: "available", lead: "Un inventaire conçu pour la revente, pas un catalogue générique.", items: ["Photos, marque, taille, catégorie, état", "Prix d'achat, frais, prix affiché et prix plancher", "Statuts stock, en vente, réservé, vendu, archivé avec transitions contrôlées", "Recherche, tri, filtres, pagination", "Import et export CSV avec prévisualisation ligne par ligne des erreurs", "Actions en lot avec confirmation, historique de modification"] },
  { icon: <MessageSquare />, id: "messagerie", title: "Messagerie et négociation", availability: "demo", lead: "Chaque conversation connaît l'article, son plancher et sa marge.", items: ["Recherche, filtres, non-lus", "Brouillons et suggestions de réponse", "Explication de la décision : accepter, contre-proposer, refuser, escalader", "Validation avant envoi par défaut", "Statut réel : brouillon, en attente, envoyé, échec", "Blocage clair si le connecteur ne permet pas l'envoi"] },
  { icon: <Users />, id: "clients", title: "Clients", availability: "available", lead: "Un CRM minimal : ce qu'il faut pour vendre, rien de plus.", items: ["Fiche client avec conversations et commandes liées", "Notes et tags", "Historique chronologique", "Déduplication par pseudo et fusion", "Données minimisées : aucune adresse ou email sans besoin"] },
  { icon: <Package />, id: "commandes", title: "Commandes et expédition", availability: "available", lead: "Une commande = un article, un client, une marge figée.", items: ["Création sans doublon grâce à une clé d'idempotence", "Transitions contrôlées : en attente, payée, expédiée, livrée, terminée, annulée, remboursée", "Prix final, frais, marge brute", "Suivi d'expédition et document uniquement s'il est fourni par le connecteur", "Aucun faux bordereau : un document de démonstration est toujours marqué comme tel"] },
  { icon: <ClipboardList />, id: "analyses", title: "Analyses", availability: "available", lead: "Des chiffres calculés depuis vos données, avec les conventions affichées.", items: ["Ventes, marge brute, panier moyen, rotation du stock", "Séries temporelles, ventilation par catégorie, canal et marque", "Filtres par période, catégorie et canal", "Export CSV", "La marge brute n'est jamais présentée comme un bénéfice net comptable"] },
  { icon: <Workflow />, id: "automatisations", title: "Automatisations", availability: "demo", lead: "Des règles explicites, une file de tâches visible et un bouton d'arrêt.", items: ["Règles avec horaires, limites par jour et par acheteur", "Validation humaine par défaut pour les actions sensibles", "File de tâches, historique d'exécution, nouvelle tentative maîtrisée", "Prévention des doublons par clé d'idempotence", "Pause par règle et arrêt global", "Indication claire de ce qui exige un navigateur ouvert"] },
  { icon: <Radar />, id: "bonnes-affaires", title: "Bonnes affaires (radar)", availability: "demo", lead: "Avec vos filtres, le radar repère les articles et note chacun sur 100.", items: ["Grille de lecture : 0–59 faible, 60–74 correcte, 75–84 bonne, 85–94 très bonne, 95–100 exceptionnelle", "Critères expliqués : marge, taux, état et photos, marque et demande, vendeur, port", "Total d'achat calculé : prix + port + protection acheteurs", "Revente estimée, bénéfice et pourcentage de marge"] },
  { icon: <ShoppingCart />, id: "a-valider", title: "À valider", availability: "demo", lead: "Les bonnes affaires repérées, à valider en un clic.", items: ["Liste des affaires notées 75/100 ou plus", "Validation en un clic avec contrôles (budget, plafond, doublon, marge)", "Historique des achats avec photo, mode manuel ou automatique", "Achat réel désactivé : simulation clairement marquée"] },
  { icon: <Bot />, id: "achat-auto", title: "Achat auto", availability: "demo", lead: "Au-dessus de votre seuil, l'application achète seule, avec garde-fous.", items: ["Seuil réglable (85/100 conseillé)", "Plafond de dépense par jour et prix maximal par article", "Délai pour vérifier et annuler l'achat", "Désactivé par défaut"] },
  { icon: <Settings />, id: "parametres", title: "Paramètres", availability: "available", lead: "Organisation, rôles, connexions, IA, abonnement, sécurité, données.", items: ["Rôles propriétaire, administrateur, opérateur, lecture", "Connexions avec test, révocation, dernière synchronisation", "Export et suppression des données", "Statut des services"] },
  { icon: <ShieldCheck />, id: "securite", title: "Sécurité", availability: "available", lead: "Isolation par organisation et contrôles côté serveur.", items: ["Montants en centimes entiers, jamais de flottant monétaire", "Messages acheteurs traités comme données non fiables", "Secrets hors du navigateur et hors de Git", "Journal d'audit des actions sensibles"] },
];

export default function Features() {
  usePageMeta("Fonctionnalités", "Tous les modules de Selio : générateur d'annonces, dressing intelligent, analyse des revendeurs, stock, messagerie, clients, commandes, analyses, automatisations, bonnes affaires, achat auto, paramètres et sécurité.");
  return (
    <>
      <MarketingSection level={1} reveal eyebrow="Fonctionnalités" title="Un module par problème concret de revendeur" lead="Chaque module indique honnêtement son état : disponible, démontré en simulation, expérimental ou en préparation.">
        <nav aria-label="Aller à un module" className="mk-index">
          {MODULES.map((m) => (
            <a key={m.id} href={`#${m.id}`} data-tone={GOLD.has(m.id) ? "gold" : undefined}>{m.title}</a>
          ))}
        </nav>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {MODULES.map((m) => (
            <article key={m.id} id={m.id} className="card mk-card scroll-mt-20 p-5 md:p-6" data-reveal="">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mk-icon" data-tone={GOLD.has(m.id) ? "gold" : undefined} aria-hidden>{m.icon}</span>
                  <h2 className="text-md font-semibold text-text">{m.title}</h2>
                </div>
                <AvailabilityBadge value={m.availability} />
              </div>
              <p className="mt-3 text-sm text-text-muted">{m.lead}</p>
              <div className="mt-4"><CheckList items={m.items} /></div>
            </article>
          ))}
        </div>
      </MarketingSection>
      <CtaBand seed={11} title="Voyez les modules fonctionner ensemble" lead="La démonstration enchaîne le parcours complet avec des données fictives persistantes." />
    </>
  );
}
