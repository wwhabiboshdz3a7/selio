import { Link } from "react-router";
import { HELP_CATEGORIES, helpEntries } from "@selio/domain/help";
import { faqPageJsonLd, useMarketingMeta } from "../seo";
import { useSession } from "../../lib/data/provider";
import { CtaBand, FaqList, JsonLd, MarketingSection } from "../components";
import { OBJECTIONS } from "../objections";
import { FaqBrowser, HelpAskPanel, askFaqLocally } from "../../components/help";

/** Questions propres à l'application, jamais montrées sur la vitrine (aucune aujourd'hui : la FAQ ne parle plus de démonstration). */
const VITRINE_HIDDEN: readonly string[] = [];

/**
 * Aide publique : la FAQ complète (contenu partagé avec l'application et le serveur) et
 * « Poser une question » par recherche locale. La vitrine n'appelle pas l'assistant IA
 * (route réservée aux sessions, voir docs/DECISIONS.md D16).
 */
export default function Faq() {
  useMarketingMeta("/faq");
  const session = useSession();
  const visible = helpEntries().filter((e) => !VITRINE_HIDDEN.includes(e.id));
  return (
    <>
      <JsonLd data={faqPageJsonLd([...OBJECTIONS, ...visible])} />
      <MarketingSection
        level={1}
        eyebrow="Aide"
        title="Aide et questions fréquentes"
        lead={`${visible.length} réponses en ${HELP_CATEGORIES.length} catégories, fidèles à l'application telle qu'elle est aujourd'hui : ce qui n'existe pas encore est dit « en préparation ».`}
      >
        <div className="max-w-3xl">
          <section aria-labelledby="avant-de-commencer" className="mb-10">
            <h2 id="avant-de-commencer" className="text-lg font-semibold tracking-[-0.01em] text-text">Avant de commencer</h2>
            <p className="mt-1 text-sm text-text-muted">Carte bancaire, résiliation, mot de passe Vinted, risques et données : les réponses courtes.</p>
            <FaqList className="mt-4" items={OBJECTIONS} />
          </section>
          <HelpAskPanel
            engine="local"
            ask={askFaqLocally}
            sourceHref={(id) => `/faq#${id}`}
            footer={<>Avec un compte connecté, l'<Link to="/app/help" className="font-medium text-accent hover:underline">aide de l'application</Link> fait rédiger la réponse par l'assistant IA, à partir des mêmes passages. Pas de réponse ? La page <Link to="/contact" className="font-medium text-accent hover:underline">Contact</Link> indique comment nous joindre.</>}
          />
          <FaqBrowser className="mt-10" basePath="/faq" appLinks={Boolean(session.data)} exclude={VITRINE_HIDDEN} />
        </div>
      </MarketingSection>
      <CtaBand seed={29} title="Le plus simple : essayer" lead="14 jours avec toutes les fonctions du plan Pro, sur votre propre activité. Rien n'est débité avant la fin de l'essai." />
    </>
  );
}
