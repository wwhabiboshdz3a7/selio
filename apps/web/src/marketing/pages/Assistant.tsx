import { usePageMeta } from "../../lib/seo";
import { CheckList, CtaBand, FeatureCard, MarketingSection, PlannedList } from "../components";

export default function Assistant() {
  usePageMeta("Assistant IA", "L'assistant Selio rédige, vos règles décident : prix plancher, marge minimale, horaires et limites par acheteur restent déterministes. Fonctionne avec un serveur Ollama privé.");
  return (
    <>
      <MarketingSection level={1} eyebrow="Assistant IA" title="L'IA propose un texte. Vos règles décident." lead="Avant toute suggestion, une politique déterministe évalue l'offre : au-dessus du plancher, dans la remise autorisée, dans les horaires, sous la limite par acheteur. L'assistant ne fait que rédiger la réponse correspondant à cette décision, puis cette réponse est vérifiée.">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Politique métier d'abord" availability="available">Prix plancher, marge minimale, remise maximale, nombre de tours, horaires, escalade. Chaque décision est expliquée ligne par ligne.</FeatureCard>
          <FeatureCard title="Sortie validée" availability="available">La réponse est contrôlée par un schéma puis par les règles : pas de prix différent du prix imposé, pas de lien, pas de HTML, pas de fuite du prix d'achat.</FeatureCard>
          <FeatureCard title="Données non fiables" availability="available">Les messages acheteurs sont traités comme des données, jamais comme des instructions. Les tentatives d'injection sont repérées et journalisées.</FeatureCard>
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Infrastructure" title="Un modèle hébergé chez vous, raccordé par le serveur" className="border-t border-border bg-surface">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-md font-semibold text-text">Comment ça fonctionne</h3>
            <div className="mt-3"><CheckList items={["Le navigateur n'appelle jamais directement le serveur IA : tout passe par l'API Selio, authentifiée", "File de demandes à concurrence limitée, délai maximal, annulation", "Disjoncteur : en cas d'indisponibilité, les automatisations basculent sur des gabarits déterministes et le statut est affiché", "Quotas par organisation, métriques de latence et de consommation", "Un résultat simulé ne remplace jamais une réponse du modèle en production"]} /></div>
          </div>
          <div>
            <h3 className="text-md font-semibold text-text">Où en est-on</h3>
            <div className="mt-3"><PlannedList items={["Provider Ollama écrit et testé sur HTTP simulé ; serveur matériel à raccorder", "Aucune latence ni capacité annoncée tant que le matériel cible n'a pas été mesuré", "La démonstration utilise un simulateur déterministe, clairement signalé", "Un autre fournisseur pourra être ajouté via la même interface, sans appel payant automatique"]} /></div>
          </div>
        </div>
      </MarketingSection>
      <CtaBand title="Voyez une suggestion et sa justification" lead="Dans la démo, ouvrez une conversation avec une offre, générez une proposition et lisez pourquoi elle est acceptée, contre-proposée ou refusée." />
    </>
  );
}
