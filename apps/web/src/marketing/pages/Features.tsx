import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Bot, Boxes, ClipboardList, Cpu, MessageSquare, Package, Puzzle, Radar, Repeat, Settings, ShieldCheck, Shirt, ShoppingCart, Sparkles, TrendingUp, Users, Workflow } from "lucide-react";
import { usePageMeta } from "../../lib/seo";
import { AvailabilityBadge, CheckList, CtaBand, MarketingSection, type Availability } from "../components";
import { MODULES } from "../catalog";

interface Detail {
  icon: ReactNode;
  lead: string;
  items: string[];
  more?: { to: string; label: string };
}

/**
 * Détail de chacun des quatorze modules (les mêmes que la constellation de
 * l'accueil : titre, état et ordre viennent de ../catalog).
 */
const DETAILS: Record<string, Detail> = {
  generateur: { icon: <Sparkles />, lead: "Vous ajoutez les photos, l'IA rédige l'annonce. Notre grande différence.", items: ["Photos glissées-déposées ou prises au téléphone, compressées dans le navigateur", "Titre, description, marque, catégorie, taille, état, couleurs, matière", "Prix conseillé calculé sur les ventes comparables (jamais inventé par l'IA)", "Choix du compte Vinted, puis brouillon ou publication directe", "Mon modèle perso (texte + vision) prêt à brancher"] },
  dressing: { icon: <Shirt />, lead: "Chaque annonce en ligne notée sur 100, avec ce qu'il faut améliorer.", items: ["Note : visibilité, attractivité, qualité de l'annonce, prix face au marché", "Les points à améliorer, annonce par annonce", "Tri « en ligne depuis 7 jours ou plus » pour savoir quoi republier"] },
  republications: { icon: <Repeat />, lead: "Des variantes prêtes à l'emploi pour relancer une annonce qui stagne.", items: ["10 republications pré-faites par annonce (minimum 8) : titre, description, prix, couverture, créneau", "Suivi des variantes déjà utilisées", "Rendement de chaque variante mesuré à 48 h", "Proposées depuis le dressing, pour les annonces en ligne depuis 7 jours ou plus"] },
  revendeurs: { icon: <TrendingUp />, lead: "Qui vend le plus, quoi, à quel prix : repérez les niches qui marchent.", items: ["Classement des grands revendeurs par chiffre d'affaires estimé", "Niche principale de chaque vendeur, marques, catégories, rotation, tendance", "Niches à forte demande et faible concurrence", "Calculé sur les annonces observées par le radar et l'extension"] },
  "bonnes-affaires": { icon: <Radar />, lead: "Avec vos filtres, le radar repère les articles et note chacun sur 100.", items: ["Grille de lecture : 0–59 faible, 60–74 correcte, 75–84 bonne, 85–94 très bonne, 95–100 exceptionnelle", "Critères expliqués : marge, taux, état et photos, marque et demande, vendeur, port", "Total d'achat calculé : prix + port + protection acheteurs", "Revente estimée, bénéfice et pourcentage de marge"] },
  "a-valider": { icon: <ShoppingCart />, lead: "Les bonnes affaires repérées, à valider en un clic.", items: ["Liste des affaires notées 75/100 ou plus", "Validation en un clic avec contrôles (budget, plafond, doublon, marge)", "Historique des achats avec photo, mode manuel ou automatique", "Achat réel désactivé : simulation clairement marquée"] },
  "achat-auto": { icon: <Bot />, lead: "Au-dessus de votre seuil, l'application achète seule, avec garde-fous.", items: ["Seuil réglable (85/100 conseillé)", "Plafond de dépense par jour et prix maximal par article", "Délai pour vérifier et annuler l'achat", "Désactivé par défaut, simulé tant qu'aucun connecteur d'achat n'est autorisé"] },
  messagerie: { icon: <MessageSquare />, lead: "Chaque conversation connaît l'article, son plancher et sa marge.", items: ["Recherche, filtres, non-lus", "Brouillons et suggestions de réponse", "Explication de la décision : accepter, contre-proposer, refuser, escalader", "Validation avant envoi par défaut", "Statut réel : brouillon, en attente, envoyé, échec", "Blocage clair si le connecteur ne permet pas l'envoi"] },
  stock: { icon: <Boxes />, lead: "Un inventaire conçu pour la revente, pas un catalogue générique.", items: ["Photos, marque, taille, catégorie, état", "Prix d'achat, frais, prix affiché et prix plancher", "Statuts stock, en vente, réservé, vendu, archivé avec transitions contrôlées", "Recherche, tri, filtres, pagination", "Import et export CSV avec prévisualisation ligne par ligne des erreurs", "Actions en lot avec confirmation, historique de modification"] },
  commandes: { icon: <Package />, lead: "Une commande = un article, un client, une marge figée.", items: ["Création sans doublon grâce à une clé d'idempotence", "Transitions contrôlées : en attente, payée, expédiée, livrée, terminée, annulée, remboursée", "Prix final, frais, marge brute", "Suivi d'expédition et document uniquement s'il est fourni par le connecteur", "Aucun faux bordereau : un document de démonstration est toujours marqué comme tel"] },
  analyses: { icon: <ClipboardList />, lead: "Des chiffres calculés depuis vos données, avec les conventions affichées.", items: ["Ventes, marge brute, panier moyen, rotation du stock", "Séries temporelles, ventilation par catégorie, canal et marque", "Filtres par période, catégorie et canal", "Export CSV", "La marge brute n'est jamais présentée comme un bénéfice net comptable"] },
  automatisations: { icon: <Workflow />, lead: "Des règles explicites, une file de tâches visible et un bouton d'arrêt.", items: ["Règles avec horaires, limites par jour et par acheteur", "Validation humaine par défaut pour les actions sensibles", "File de tâches, historique d'exécution, nouvelle tentative maîtrisée", "Prévention des doublons par clé d'idempotence", "Pause par règle et arrêt global", "Indication claire de ce qui exige un navigateur ouvert"] },
  extension: { icon: <Puzzle />, lead: "Depuis la page Vinted que vous avez ouverte, avec confirmation avant toute action.", items: ["Capture d'un article visible vers votre stock, avec prévisualisation", "Brouillon de réponse conforme à vos règles, que vous relisez et envoyez", "Permissions minimales, jeton révocable, aucun mot de passe stocké", "Construite et testée sur des fixtures : à valider dans un navigateur réel"], more: { to: "/extension", label: "Tout savoir sur l'extension" } },
  "ia-perso": { icon: <Cpu />, lead: "Mon modèle perso, un modèle privé appelé par le serveur Selio, jamais depuis le navigateur.", items: ["Vos règles décident, le modèle ne fait que rédiger la réponse", "File de demandes, délai maximal, disjoncteur vers des gabarits déterministes", "Connexion écrite et testée sur HTTP simulé ; serveur matériel à raccorder", "La démonstration utilise un simulateur, clairement signalé"], more: { to: "/assistant-ia", label: "Voir l'assistant IA" } },
};

/** Le socle commun aux quatorze modules. */
const FOUNDATION: { id: string; icon: ReactNode; title: string; availability: Availability; lead: string; items: string[] }[] = [
  { icon: <Users />, id: "clients", title: "Clients", availability: "available", lead: "Un CRM minimal : ce qu'il faut pour vendre, rien de plus.", items: ["Fiche client avec conversations et commandes liées", "Notes et tags, historique chronologique", "Déduplication par pseudo et fusion", "Données minimisées : aucune adresse ou email sans besoin"] },
  { icon: <Settings />, id: "parametres", title: "Paramètres", availability: "available", lead: "Organisation, rôles, connexions, IA, abonnement, sécurité, données.", items: ["Rôles propriétaire, administrateur, opérateur, lecture", "Connexions avec test, révocation, dernière synchronisation", "Export et suppression des données", "Statut des services"] },
  { icon: <ShieldCheck />, id: "securite", title: "Sécurité", availability: "available", lead: "Isolation par organisation et contrôles côté serveur.", items: ["Montants en centimes entiers, jamais de flottant monétaire", "Messages acheteurs traités comme données non fiables", "Secrets hors du navigateur et hors de Git", "Journal d'audit des actions sensibles"] },
];

export default function Features() {
  usePageMeta("Fonctionnalités", "Les quatorze modules de Selio, avec leur état honnête : générateur d'annonces IA, dressing intelligent, republications, analyse des revendeurs, bonnes affaires, achat auto, messagerie, stock, commandes, analyses, automatisations, extension et IA personnelle. Plus le socle commun : clients, paramètres, sécurité.");
  return (
    <>
      <MarketingSection level={1} reveal eyebrow="Fonctionnalités" title="Quatorze modules, un par problème concret de revendeur" lead="Les quatorze étoiles de la constellation, chacune avec son état honnête : disponible, en démonstration, expérimental ou en préparation. Le socle commun (clients, paramètres, sécurité) est détaillé plus bas.">
        <nav aria-label="Aller à un module" className="mk-index">
          {MODULES.map((m) => (
            <a key={m.id} href={`#${m.id}`} data-tone={m.tone === "gold" ? "gold" : undefined}>{m.title}</a>
          ))}
        </nav>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {MODULES.map((m, i) => {
            const d = DETAILS[m.id];
            if (!d) return null;
            return (
              <article key={m.id} id={m.id} className="card mk-card scroll-mt-20 flex flex-col p-5 md:p-6" data-reveal="">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="mk-icon" data-tone={m.tone === "gold" ? "gold" : undefined} aria-hidden>{d.icon}</span>
                    <h2 className="text-md font-semibold text-text"><span className="num mr-2 text-sm font-medium text-text-subtle" aria-hidden>{String(i + 1).padStart(2, "0")}</span>{m.title}</h2>
                  </div>
                  <AvailabilityBadge value={m.status} />
                </div>
                <p className="mt-3 text-sm text-text-muted">{d.lead}</p>
                <div className="mt-4 flex-1"><CheckList items={d.items} /></div>
                {d.more ? (
                  <Link to={d.more.to} className="mt-4 inline-flex items-center gap-1 self-start text-sm font-medium text-accent hover:underline">
                    {d.more.label} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      </MarketingSection>
      <MarketingSection reveal eyebrow="Le socle" title="Ce qui relie les quatorze modules" lead="Présent dans chaque organisation, quel que soit le plan." className="border-t border-border bg-surface">
        <div className="grid gap-4 md:grid-cols-3">
          {FOUNDATION.map((m) => (
            <article key={m.id} id={m.id} className="rounded-xl border border-border bg-bg scroll-mt-20 p-5" data-reveal="">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mk-icon" aria-hidden>{m.icon}</span>
                  <h3 className="text-md font-semibold text-text">{m.title}</h3>
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
