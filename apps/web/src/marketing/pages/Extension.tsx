import { Link } from "react-router";
import { Button } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { CheckList, CtaBand, FeatureCard, MarketingSection, PlannedList } from "../components";

export default function Extension() {
  usePageMeta("Extension navigateur", "L'extension Selio capture un article visible vers votre stock et aide à rédiger une réponse depuis une conversation ouverte, avec confirmation avant toute action.");
  return (
    <>
      <MarketingSection eyebrow="Extension navigateur" title="Votre navigateur reste le seul endroit où votre session existe" lead="Selio n'a jamais votre mot de passe Vinted. L'extension lit la page que vous avez ouverte, vous montre ce qu'elle a compris, et n'agit qu'après votre confirmation.">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Capture d'article" availability="experimental">Depuis une page article visible, envoyez titre, marque, taille, état, prix et photos vers votre stock, avec prévisualisation.</FeatureCard>
          <FeatureCard title="Aide à la rédaction" availability="experimental">Depuis une conversation ouverte, obtenez un brouillon conforme à vos règles de marge, pré-rempli dans le champ de réponse. Vous relisez, vous envoyez.</FeatureCard>
          <FeatureCard title="Règles de prix visibles" availability="available">Le panneau affiche le prix plancher et la marge de l'article concerné pour décider en connaissance de cause.</FeatureCard>
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Sécurité" title="Ce que l'extension ne fait pas" className="border-t border-border bg-surface">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-md font-semibold text-text">Engagements</h3>
            <div className="mt-3"><CheckList items={["Permissions minimales, domaines limités et expliqués", "Jeton d'extension limité, révocable et renouvelable depuis l'application", "Aucun stockage de mot de passe, aucune collecte de cookies ou de session", "Aucun contournement de CAPTCHA ni de protection anti-robot", "Aucun clic aveugle : échec propre si la page a changé", "Aucun envoi automatique sans règle explicite et contrôle approprié"]} /></div>
          </div>
          <div>
            <h3 className="text-md font-semibold text-text">État de validation</h3>
            <div className="mt-3"><PlannedList items={["Les adaptateurs de page sont construits et testés sur des fixtures", "Ils doivent être validés dans un navigateur réel sur le site cible avant d'être annoncés comme fonctionnels", "Vinted ne propose pas d'API publique pour les vendeurs : Selio n'affirme aucune compatibilité officielle", "Les actions qui exigent un navigateur ouvert ne sont jamais présentées comme disponibles 24 h/24"]} /></div>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <Link to="/inscription"><Button>Créer un compte pour associer l'extension</Button></Link>
          <a href="https://github.com" className="hidden" aria-hidden>…</a>
        </div>
        <p className="mt-3 text-xs text-text-muted">Installation non empaquetée documentée dans le dépôt (docs/EXTENSION-INSTALL.md). Pas encore publiée sur le Chrome Web Store.</p>
      </MarketingSection>
      <CtaBand title="Testez l'association extension ↔ compte" lead="Créez un jeton d'extension depuis les paramètres, collez-le dans l'extension, et vérifiez le diagnostic de compatibilité." />
    </>
  );
}
