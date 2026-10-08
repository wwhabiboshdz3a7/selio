import { useLocation } from "react-router";
import { Alert } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container } from "../components";

const PAGES: Record<string, { title: string; sections: { h: string; p: string[] }[] }> = {
  "/mentions-legales": {
    title: "Mentions légales",
    sections: [
      { h: "Éditeur", p: ["[À compléter : dénomination sociale, forme juridique, capital, siège social, RCS, numéro de TVA, directeur de la publication, adresse email de contact.]"] },
      { h: "Hébergement", p: ["Vitrine et application web : [hébergeur à préciser, ex. Netlify, Inc.]. API et traitements : [serveur Linux, hébergeur à préciser]."] },
      { h: "Indépendance", p: ["Selio est un outil indépendant, sans lien d'affiliation, de partenariat ou d'approbation avec Vinted ou toute autre place de marché citée. Les marques mentionnées appartiennent à leurs propriétaires respectifs."] },
    ],
  },
  "/confidentialite": {
    title: "Politique de confidentialité",
    sections: [
      { h: "Données traitées", p: ["Compte : email, nom d'affichage, mot de passe haché. Organisation : articles, clients (pseudo, ville facultative, notes), conversations, commandes, règles, journaux techniques.", "Principe de minimisation : aucune adresse postale ni email d'acheteur n'est collecté sans besoin métier explicite."] },
      { h: "Finalités et base légale", p: ["[À compléter : exécution du contrat, intérêt légitime pour la sécurité, consentement pour les notifications.]"] },
      { h: "Durées de conservation", p: ["Configurables par organisation (messages, journaux d'audit, requêtes IA). Valeurs par défaut documentées dans l'application. Suppression possible à tout moment depuis Paramètres › Données."] },
      { h: "Sous-traitants", p: ["[À compléter : hébergeur, prestataire de paiement en mode test, aucun service d'analyse tiers n'est embarqué.]"] },
      { h: "Vos droits", p: ["Accès, rectification, export (Paramètres › Données), effacement, opposition. Contact : [adresse à compléter]."] },
    ],
  },
  "/conditions": {
    title: "Conditions d'utilisation",
    sections: [
      { h: "Objet", p: ["[À compléter : description du service, conditions d'accès, modes démonstration et connecté.]"] },
      { h: "Responsabilités", p: ["L'utilisateur reste responsable du respect des conditions d'utilisation des places de marché sur lesquelles il vend. Selio n'automatise aucune action contraire à ces conditions et ne contourne aucune protection technique."] },
      { h: "Abonnement", p: ["[À compléter : plans, prix définitifs, facturation, résiliation. Les montants affichés sur la vitrine sont indicatifs.]"] },
      { h: "Droit applicable", p: ["[À compléter : droit français, juridiction compétente, médiation de la consommation.]"] },
    ],
  },
};

export default function Legal() {
  const { pathname } = useLocation();
  const page = PAGES[pathname] ?? PAGES["/mentions-legales"]!;
  usePageMeta(page.title, `${page.title} de Selio (brouillon à compléter avant publication).`, { noindex: true });
  return (
    <section className="py-12">
      <Container className="max-w-3xl">
        <h1 className="text-xl font-semibold text-text">{page.title}</h1>
        <Alert tone="warning" title="Brouillon" className="mt-4">Ce texte est un brouillon structurel. Il doit être complété et validé par un conseil juridique avant publication. Les passages entre crochets sont à renseigner.</Alert>
        <div className="prose-selio mt-6 text-base text-text">
          {page.sections.map((s) => (
            <div key={s.h}>
              <h2>{s.h}</h2>
              {s.p.map((p, i) => <p key={i} className="text-text-muted">{p}</p>)}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
