import { Link } from "react-router";
import { MousePointerClick, PenLine, Scale } from "lucide-react";
import { buttonClass } from "@selio/ui";
import { CheckList, CtaBand, FeatureCard, IndependenceNotice, JsonLd, MarketingSection, PlannedList } from "../components";
import { breadcrumbJsonLd, softwareApplicationJsonLd, seoPage, useMarketingMeta } from "../seo";

export default function Extension() {
  useMarketingMeta("/extension");
  return (
    <>
      <JsonLd data={[softwareApplicationJsonLd({ name: "Extension Selio pour Chrome", path: "/extension", description: seoPage("/extension").description, category: "BrowserApplication" }), breadcrumbJsonLd([{ name: "Accueil", path: "/" }, { name: "Extension", path: "/extension" }])]} />
      <MarketingSection level={1} reveal eyebrow="Extension navigateur" title="Votre navigateur reste le seul endroit où votre session existe" lead="Selio n'a jamais votre mot de passe Vinted. L'extension lit la page que vous avez ouverte, vous montre ce qu'elle a compris, et n'agit qu'après votre confirmation.">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<MousePointerClick />} title="Capture d'article" availability="experimental">Depuis une page article visible, envoyez titre, marque, taille, état, prix et photos vers votre stock, avec prévisualisation.</FeatureCard>
          <FeatureCard icon={<PenLine />} title="Aide à la rédaction" availability="experimental">Depuis une conversation ouverte, obtenez un brouillon conforme à vos règles de marge, pré-rempli dans le champ de réponse. Vous relisez, vous envoyez.</FeatureCard>
          <FeatureCard icon={<Scale />} tone="gold" title="Règles de prix visibles" availability="available">Le panneau affiche le prix plancher et la marge de l'article concerné pour décider en connaissance de cause.</FeatureCard>
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Sécurité" title="Ce que l'extension ne fait pas">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-md font-semibold text-text">Engagements</h3>
            <div className="mt-4"><CheckList items={["Permissions minimales, domaines limités et expliqués", "Jeton d'extension limité, révocable et renouvelable depuis l'application", "Aucun stockage de mot de passe, aucune collecte de cookies ou de session", "Aucun contournement de CAPTCHA ni de protection anti-robot", "Aucun clic aveugle : échec propre si la page a changé", "Aucun envoi automatique sans règle explicite et contrôle approprié"]} /></div>
          </div>
          <div className="card p-6">
            <h3 className="text-md font-semibold text-text">État de validation</h3>
            <div className="mt-4"><PlannedList items={["Les adaptateurs de page sont construits et testés sur des fixtures", "Ils doivent être validés dans un navigateur réel sur le site cible avant d'être annoncés comme fonctionnels", "Hors de l'API Vinted Pro Integrations (réservée aux comptes Pro admis, accès à demander), Vinted ne propose pas d'API publique : Selio n'affirme aucune compatibilité officielle", "Les actions qui exigent un navigateur ouvert ne sont jamais présentées comme disponibles 24 h/24"]} /></div>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <Link to="/inscription" className={buttonClass({ variant: "accent" })}>Créer un compte pour associer l'extension</Link>
        </div>
        <p className="mt-3 text-xs text-text-muted">Pas encore publiée sur le Chrome Web Store : la fiche, les justifications des permissions et la politique de confidentialité sont prêtes, la publication attend la validation du compte développeur. En attendant, installation non empaquetée (docs/EXTENSION-INSTALL.md).</p>
        <p className="mt-2 text-sm"><Link to="/extension/confidentialite" className="font-medium text-accent hover:underline">Confidentialité de l'extension : ce qu'elle lit, ce qu'elle envoie</Link></p>
        <IndependenceNotice className="mt-4" />
      </MarketingSection>
      <CtaBand seed={17} title="Testez l'association extension ↔ compte" lead="Créez un jeton d'extension depuis les paramètres, collez-le dans l'extension, et vérifiez le diagnostic de compatibilité." />
    </>
  );
}
