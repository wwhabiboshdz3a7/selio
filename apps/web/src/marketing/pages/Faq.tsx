import { Link } from "react-router";
import { HELP_CATEGORIES, helpEntries } from "@selio/domain/help";
import { usePageMeta } from "../../lib/seo";
import { useSession } from "../../lib/data/provider";
import { CtaBand, MarketingSection } from "../components";
import { FaqBrowser, HelpAskPanel, askFaqLocally } from "../../components/help";

/**
 * Aide publique : la FAQ complète (contenu partagé avec l'application et le serveur) et
 * « Poser une question » par recherche locale. La vitrine n'appelle pas l'assistant IA
 * (route réservée aux sessions, voir docs/DECISIONS.md D16).
 */
export default function Faq() {
  usePageMeta("Aide et FAQ", `Aide de Selio : ${helpEntries().length} questions et réponses (essai, comptes Vinted, extension, IA, dressing, achats, négociation, équipe, tarifs, données), recherche instantanée et assistant.`);
  const session = useSession();
  return (
    <>
      <MarketingSection
        level={1}
        eyebrow="Aide"
        title="Aide et questions fréquentes"
        lead={`${helpEntries().length} réponses en ${HELP_CATEGORIES.length} catégories, fidèles à l'application telle qu'elle est aujourd'hui : ce qui n'existe pas encore est dit « en préparation ».`}
      >
        <div className="max-w-3xl">
          <HelpAskPanel
            engine="local"
            ask={askFaqLocally}
            sourceHref={(id) => `/faq#${id}`}
            footer={<>Avec un compte connecté, l'<Link to="/app/help" className="font-medium text-accent hover:underline">aide de l'application</Link> fait rédiger la réponse par l'assistant IA, à partir des mêmes passages. Pas de réponse ? La page <Link to="/contact" className="font-medium text-accent hover:underline">Contact</Link> indique comment nous joindre.</>}
          />
          <FaqBrowser className="mt-10" basePath="/faq" appLinks={Boolean(session.data)} />
        </div>
      </MarketingSection>
      <CtaBand seed={29} title="Le plus simple : essayer" lead="La démonstration montre tout le parcours avec des données fictives, sans compte ni carte bancaire." />
    </>
  );
}
