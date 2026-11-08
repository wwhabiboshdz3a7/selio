import { useLocation } from "react-router";
import { Alert } from "@selio/ui";
import { Link } from "react-router";
import { Container, Eyebrow, IndependenceNotice } from "../components";
import { INDEPENDENCE_NOTICE, LEGAL_DRAFT_NOTICE, useMarketingMeta } from "../seo";

const PAGES: Record<string, { title: string; sections: { h: string; p: string[] }[] }> = {
  "/mentions-legales": {
    title: "Mentions légales",
    sections: [
      { h: "Éditeur", p: ["[À compléter : dénomination sociale, forme juridique, capital, siège social, RCS, numéro de TVA, directeur de la publication, adresse email de contact.]"] },
      { h: "Hébergement", p: ["Vitrine et application web : [hébergeur à préciser, ex. Netlify, Inc.]. API et traitements : [serveur Linux, hébergeur à préciser]."] },
      { h: "Indépendance", p: [INDEPENDENCE_NOTICE, "Selio n'a de lien d'affiliation avec aucune place de marché ni aucun outil cité. Les marques mentionnées appartiennent à leurs propriétaires respectifs."] },
    ],
  },
  "/confidentialite": {
    title: "Politique de confidentialité",
    sections: [
      { h: "Données traitées", p: ["Compte : email, nom d'affichage, mot de passe haché. Organisation : articles, clients (pseudo, ville facultative, notes), conversations, commandes, règles, journaux techniques.", "Principe de minimisation : aucune adresse postale ni email d'acheteur n'est collecté sans besoin métier explicite."] },
      { h: "Finalités et base légale", p: ["[À compléter : exécution du contrat, intérêt légitime pour la sécurité, consentement pour les notifications.]"] },
      { h: "Durées de conservation", p: ["Configurables par organisation (messages, journaux d'audit, requêtes IA). Valeurs par défaut documentées dans l'application. Suppression possible à tout moment depuis Paramètres › Données."] },
      { h: "Hébergement des données", p: ["Base de données, photos et modèles d'IA (mon IA perso) sur notre machine, en France. La vitrine statique est servie par un hébergeur de sites : [hébergeur à préciser]."] },
      { h: "Sous-traitants", p: ["[À compléter : hébergeur de la vitrine, prestataire de paiement (Revolut), service d'email à choisir ; aucun service d'analyse tiers n'est embarqué.]"] },
      { h: "Extension navigateur", p: ["Ce que l'extension lit et envoie est détaillé dans la politique de confidentialité de l'extension (/extension/confidentialite)."] },
      { h: "Vos droits", p: ["Accès, rectification, export (Paramètres › Données), effacement, opposition. Contact : [adresse à compléter]."] },
    ],
  },
  "/conditions": {
    title: "Conditions d'utilisation",
    sections: [
      { h: "Objet", p: ["[À compléter : description du service, conditions d'accès, modes démonstration et connecté.]"] },
      { h: "Indépendance", p: [INDEPENDENCE_NOTICE] },
      { h: "Responsabilités", p: ["L'utilisateur reste responsable de son compte Vinted et du respect des conditions d'utilisation des places de marché sur lesquelles il vend. Selio ne contourne aucune protection technique, ne demande aucun mot de passe Vinted et fait valider les actions importantes (prix, achat).", "Selio ne peut pas garantir qu'un compte ne sera jamais limité ou bloqué par Vinted. [À rédiger avec l'avocat : responsabilité de Selio en cas de blocage, sans clause abusive.]"] },
      { h: "Abonnement", p: ["[À compléter : plans, prix définitifs, facturation, résiliation. Les montants affichés sur la vitrine sont indicatifs.]"] },
      { h: "Droit applicable", p: ["[À compléter : droit français, juridiction compétente, médiation de la consommation.]"] },
    ],
  },
};

export default function Legal() {
  const { pathname } = useLocation();
  const page = PAGES[pathname] ?? PAGES["/mentions-legales"]!;
  useMarketingMeta(PAGES[pathname] ? pathname : "/mentions-legales");
  return (
    <section className="mk-hero py-12 md:py-16">
      <Container className="max-w-3xl">
        <Eyebrow>Informations légales</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">{page.title}</h1>
        <Alert tone="warning" title="Version provisoire" className="mt-4">{LEGAL_DRAFT_NOTICE} Ce texte doit être complété et relu par l'avocat avant d'être définitif ; les passages entre crochets sont à renseigner.</Alert>
        <div className="prose-selio mt-6 max-w-[70ch] text-base text-text">
          {page.sections.map((s) => (
            <div key={s.h}>
              <h2>{s.h}</h2>
              {s.p.map((p, i) => <p key={i} className="text-text-muted">{p}</p>)}
            </div>
          ))}
        </div>
        {pathname === "/confidentialite" ? <p className="mt-6 text-sm text-text-muted">Extension : <Link to="/extension/confidentialite" className="font-medium text-accent hover:underline">confidentialité de l'extension Selio</Link>.</p> : null}
        {page.sections.some((sec) => sec.p.includes(INDEPENDENCE_NOTICE)) ? null : <IndependenceNotice className="mt-8" />}
      </Container>
    </section>
  );
}
