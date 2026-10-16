import { useRef } from "react";
import { FileCheck2, ListChecks, ShieldAlert } from "lucide-react";
import { usePageMeta } from "../../lib/seo";
import { CheckList, Container, CtaBand, Eyebrow, FeatureCard, MarketingSection, NightSky, PlannedList, useFx } from "../components";

/** Le trajet d'une réponse : une petite constellation, de l'offre à votre validation. */
const FLOW: { k: string; title: string; text: string; gold?: boolean }[] = [
  { k: "Entrée", title: "Message reçu", text: "Traité comme une donnée, jamais comme une instruction." },
  { k: "Règles", title: "Votre politique", text: "Plancher, marge minimale, remise maximale, horaires, limite par acheteur." },
  { k: "Décision", title: "Décision expliquée", text: "Accepter, contre-proposer, refuser ou escalader : vos règles tranchent, ligne par ligne." },
  { k: "IA", title: "Le modèle rédige", text: "Il formule la décision sans pouvoir la changer. Simulateur en démonstration." },
  { k: "Contrôle", title: "Réponse vérifiée", text: "Schéma, prix imposé, aucun lien, aucune fuite du prix d'achat." },
  { k: "Vous", title: "Vous validez", text: "Par défaut, rien ne part sans votre accord.", gold: true },
];

function ResponseConstellation() {
  const ref = useRef<HTMLOListElement>(null);
  useFx(ref, "flow");
  return (
    <section className="pb-4 md:pb-8" aria-labelledby="trajet-titre">
      <Container>
        <div className="mk-night px-6 py-10 sm:px-10 md:px-12 md:py-14">
          <NightSky seed={23} lines={false} />
          <Eyebrow>Le trajet d'une réponse</Eyebrow>
          <h2 id="trajet-titre" className="mk-night-title mt-3 max-w-2xl text-xl font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px]">Six étoiles, toujours dans le même ordre</h2>
          <p className="mk-night-text mt-3 max-w-2xl text-base">L'IA n'intervient qu'à la quatrième étape. Avant elle, vos règles décident ; après elle, un contrôle vérifie, puis vous validez.</p>
          <ol ref={ref} className="mk-flow mt-10">
            {FLOW.map((s, i) => (
              <li key={s.title} className="mk-flow-step" data-tone={s.gold ? "gold" : undefined}>
                <span className="mk-flow-node" aria-hidden="true" />
                <span className="mk-flow-link" aria-hidden="true" />
                <div className="mk-flow-body">
                  <p className="mk-flow-k num">{String(i + 1).padStart(2, "0")} · {s.k}</p>
                  <h3 className="mk-flow-title">{s.title}</h3>
                  <p className="mk-flow-text">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}

export default function Assistant() {
  usePageMeta("Assistant IA", "L'assistant Selio rédige, vos règles décident : prix plancher, marge minimale, horaires et limites par acheteur restent déterministes. Fonctionne avec mon modèle perso, hébergé sur un serveur privé.");
  return (
    <>
      <MarketingSection level={1} reveal eyebrow="Assistant IA" title="L'IA propose un texte. Vos règles décident." lead="Avant toute suggestion, une politique déterministe évalue l'offre : au-dessus du plancher, dans la remise autorisée, dans les horaires, sous la limite par acheteur. L'assistant ne fait que rédiger la réponse correspondant à cette décision, puis cette réponse est vérifiée.">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<ListChecks />} title="Politique métier d'abord" availability="available">Prix plancher, marge minimale, remise maximale, nombre de tours, horaires, escalade. Chaque décision est expliquée ligne par ligne.</FeatureCard>
          <FeatureCard icon={<FileCheck2 />} title="Sortie validée" availability="available">La réponse est contrôlée par un schéma puis par les règles : pas de prix différent du prix imposé, pas de lien, pas de HTML, pas de fuite du prix d'achat.</FeatureCard>
          <FeatureCard icon={<ShieldAlert />} tone="gold" title="Données non fiables" availability="available">Les messages acheteurs sont traités comme des données, jamais comme des instructions. Les tentatives d'injection sont repérées et journalisées.</FeatureCard>
        </div>
      </MarketingSection>
      <ResponseConstellation />
      <MarketingSection eyebrow="Infrastructure" title="Un modèle hébergé chez vous, raccordé par le serveur">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-md font-semibold text-text">Comment ça fonctionne</h3>
            <div className="mt-4"><CheckList items={["Le navigateur n'appelle jamais directement le serveur IA : tout passe par l'API Selio, authentifiée", "File de demandes à concurrence limitée, délai maximal, annulation", "Disjoncteur : en cas d'indisponibilité, les automatisations basculent sur des gabarits déterministes et le statut est affiché", "Quotas par organisation, métriques de latence et de consommation", "Un résultat simulé ne remplace jamais une réponse du modèle en production"]} /></div>
          </div>
          <div className="card p-6">
            <h3 className="text-md font-semibold text-text">Où en est-on</h3>
            <div className="mt-4"><PlannedList items={["Connexion à mon modèle perso écrite et testée sur HTTP simulé ; serveur matériel à raccorder", "Aucune latence ni capacité annoncée tant que le matériel cible n'a pas été mesuré", "La démonstration utilise un simulateur déterministe, clairement signalé", "Un autre fournisseur pourra être ajouté via la même interface, sans appel payant automatique"]} /></div>
          </div>
        </div>
      </MarketingSection>
      <CtaBand seed={5} title="Voyez une suggestion et sa justification" lead="Dans la démo, ouvrez une conversation avec une offre, générez une proposition et lisez pourquoi elle est acceptée, contre-proposée ou refusée." />
    </>
  );
}
