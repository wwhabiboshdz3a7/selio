import { usePageMeta } from "../lib/seo";

/**
 * Référencement de la vitrine : une seule liste des pages publiques (titre,
 * description, indexation), la mention d'indépendance, les promesses interdites
 * et les données structurées (schema.org). Le sitemap (public/sitemap.xml) est
 * vérifié contre cette liste par seo.test.ts : une page ajoutée ici sans être
 * ajoutée au sitemap (ou l'inverse) fait échouer les tests.
 *
 * Aucune promesse de classement : les mots-clés visés (docs/VITRINE.md) sont
 * placés dans les titres et les descriptions, sans jamais garantir une position.
 */

/**
 * Domaine public de la vitrine, utilisé par le sitemap, robots.txt et les données
 * structurées. **À confirmer par Ibrahim** (aucun domaine n'est encore acheté ni
 * relié) : à changer ici, dans public/sitemap.xml, public/robots.txt et index.html
 * (seo.test.ts vérifie que les quatre restent identiques).
 */
export const SITE_ORIGIN = "https://selio.fr";

/** Mention d'indépendance, mot pour mot, partout où elle est pertinente (étude juridique, §5.15). */
export const INDEPENDENCE_NOTICE = "Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.";

/** Statut des textes juridiques tant que l'avocat ne les a pas relus. */
export const LEGAL_DRAFT_NOTICE = "Version provisoire, définitive après l'avocat.";

/**
 * Pages « Selio ou Bleam ? » et « Alternative à Bleam » : prêtes à publier seulement
 * quand les textes d'Elias sont insérés et que l'avocat a relu le comparatif
 * (publicité comparative). Tant que c'est faux : pages non indexées, absentes du
 * sitemap et du pied de page, bandeau « en préparation » affiché.
 */
export const COMPARISON_READY = false;

export interface SeoPage {
  path: string;
  /** Titre de l'onglet (« — Selio » est ajouté s'il manque). */
  title: string;
  /** Meta description : 160 caractères au plus, sans promesse de classement. */
  description: string;
  indexable: boolean;
  /** Priorité indicative du sitemap (0 à 1). */
  priority: number;
}

/** Les pages publiques de la vitrine (hors connexion, inscription, liens reçus par email). */
export const SEO_PAGES: readonly SeoPage[] = [
  { path: "/", title: "Selio — Logiciel de gestion pour revendeurs Vinted", description: "Outil revendeur Vinted : stock, messages, négociation, commandes et marges au même endroit. Une gestion Vinted claire, des automatisations au rythme humain.", indexable: true, priority: 1 },
  { path: "/fonctionnalites", title: "Fonctionnalités du logiciel Vinted", description: "Les quatorze modules de Selio et leur état réel : générateur d'annonces, dressing noté sur 100, négociation, stock, commandes, analyses et automatisations.", indexable: true, priority: 0.8 },
  { path: "/plateforme", title: "Une plateforme, puis des filiales", description: "Selio, l'outil de gestion des revendeurs, et ses filiales Studio, Track, Radar, Cloud et Comptes, chacune avec son état réel : disponible ou en préparation.", indexable: true, priority: 0.8 },
  { path: "/produits/manager", title: "Selio Manager — gestion Vinted au quotidien", description: "Stock, dressing, messagerie, négociation, commandes et marges de vos comptes Vinted. Vos règles décident, l'IA rédige, vous validez.", indexable: true, priority: 0.9 },
  { path: "/produits/studio", title: "Selio Studio — annonces Vinted à partir des photos", description: "Vos photos deviennent des annonces : titre, description, attributs lus sur l'étiquette avec leur provenance, prix tiré des ventes comparables.", indexable: true, priority: 0.9 },
  { path: "/produits/track", title: "Selio Track — statistiques du marché Vinted", description: "Prix médian, annonces actives et ventes estimées des filtres que vous suivez, niches notées sur 100 : des statistiques, jamais d'annonce republiée.", indexable: true, priority: 0.8 },
  { path: "/produits/radar", title: "Selio Radar — bonnes affaires Vinted notées sur 100", description: "Les articles de vos recherches notés sur 100 : coût réel, revente estimée, bénéfice. Alerte sur le téléphone, et c'est vous qui achetez.", indexable: true, priority: 0.8 },
  { path: "/produits/cloud", title: "Selio Cloud — automatisation Vinted ordinateur éteint", description: "Vos réponses et relances continuent ordinateur éteint, au rythme humain, avec votre accord, compte par compte. Pause au premier avertissement.", indexable: true, priority: 0.8 },
  { path: "/produits/comptes", title: "Selio Comptes — ouvrir sa boutique Vinted", description: "Une checklist à suivre vous-même pour ouvrir et préparer un compte vendeur Vinted, et des textes prêts à copier. Selio ne crée aucun compte à votre place.", indexable: true, priority: 0.6 },
  { path: "/selio-ou-bleam", title: "Selio ou Bleam ? Comparatif pour revendeurs Vinted", description: "Selio ou Bleam : ce que fait chaque outil revendeur Vinted, avec les sources. Fonctions, principes, données et migration sans identifiants.", indexable: COMPARISON_READY, priority: 0.7 },
  { path: "/alternative-bleam", title: "Alternative à Bleam, V-Tools ou Clemz — Selio", description: "Une alternative à Bleam, V-Tools ou Clemz pour gérer et automatiser Vinted : stock, négociation, marges, sans mot de passe ni contournement.", indexable: COMPARISON_READY, priority: 0.7 },
  { path: "/extension", title: "Extension navigateur pour Vinted", description: "L'extension Selio capture un article visible vers votre stock et prépare une réponse depuis une conversation ouverte. Vous confirmez chaque action.", indexable: true, priority: 0.7 },
  { path: "/extension/confidentialite", title: "Confidentialité de l'extension", description: "Ce que l'extension Selio lit, ce qu'elle envoie à Selio et ce qu'elle ne collecte jamais (version provisoire, définitive après l'avocat).", indexable: false, priority: 0.3 },
  { path: "/assistant-ia", title: "Assistant IA", description: "L'assistant Selio rédige, vos règles décident : prix plancher, marge minimale, horaires et limites par acheteur restent déterministes.", indexable: true, priority: 0.6 },
  { path: "/tarifs", title: "Tarifs", description: "Essai de 14 jours, offres Starter, Pro et Agence pour 1, 3 ou 10 comptes Vinted, filiales en option. Montants indicatifs, non définitifs.", indexable: true, priority: 0.8 },
  { path: "/faq", title: "Aide et FAQ", description: "Les questions fréquentes sur Selio : essai, comptes Vinted, extension, IA, dressing, achats, négociation, équipe, tarifs et données.", indexable: true, priority: 0.6 },
  { path: "/contact", title: "Contact", description: "Contacter l'équipe Selio : question produit, demande de démonstration guidée, signalement.", indexable: true, priority: 0.4 },
  { path: "/mentions-legales", title: "Mentions légales", description: "Mentions légales de Selio (version provisoire, définitive après l'avocat).", indexable: false, priority: 0.1 },
  { path: "/confidentialite", title: "Politique de confidentialité", description: "Politique de confidentialité de Selio (version provisoire, définitive après l'avocat).", indexable: false, priority: 0.1 },
  { path: "/conditions", title: "Conditions d'utilisation", description: "Conditions d'utilisation de Selio (version provisoire, définitive après l'avocat).", indexable: false, priority: 0.1 },
];

/** Mots-clés visés (titres, descriptions, intertitres) : jamais une promesse de position. */
export const TARGET_KEYWORDS = ["alternative à Bleam", "alternative à V-Tools", "alternative à Clemz", "outil revendeur Vinted", "automatisation Vinted", "logiciel Vinted", "gestion Vinted"] as const;

export function seoPage(path: string): SeoPage {
  const page = SEO_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`Page de vitrine inconnue du référencement : ${path}`);
  return page;
}

/** Titre, description et indexation d'une page de la vitrine, depuis la liste ci-dessus. */
export function useMarketingMeta(path: string, overrides: { description?: string } = {}) {
  const page = seoPage(path);
  usePageMeta(page.title, overrides.description ?? page.description, { noindex: !page.indexable });
}

/**
 * Promesses interdites (règles non négociables, étude juridique) : jamais de
 * classement garanti, jamais « zéro risque » ni « 100 % légal », jamais de
 * partenariat avec Vinted. Les formes niées de la mention d'indépendance
 * (« ni approuvé par Vinted ») ne sont pas des promesses et sont tolérées.
 */
export const FORBIDDEN_CLAIMS: readonly { id: string; label: string; pattern: RegExp }[] = [
  { id: "classement", label: "promesse de classement Google", pattern: /(premi[eè]re|1\s?(?:re|ère|er)) (position|place|page)|(top|n°\s?)\s?\d+ (de |sur |dans )?google|garanti[e]? (sur|dans) google/i },
  { id: "zero-risque", label: "« zéro risque »", pattern: /z[ée]ro risque|sans (aucun )?risque|risque (nul|z[ée]ro)/i },
  { id: "legal", label: "« 100 % légal »", pattern: /100\s?%\s?(l[ée]gal|conforme|autoris[ée])/i },
  { id: "partenaire", label: "partenariat avec Vinted", pattern: /partenaire (officiel )?(de )?vinted|en partenariat avec vinted|(?<!ni )(?<!non )(approuv[ée]e?|certifi[ée]e?|recommand[ée]e?|sponsoris[ée]e?) par vinted/i },
];

/** Promesses interdites trouvées dans un texte (vide = rien à corriger). */
export function findForbiddenClaims(text: string): { id: string; label: string; match: string }[] {
  const found: { id: string; label: string; match: string }[] = [];
  for (const rule of FORBIDDEN_CLAIMS) {
    const m = rule.pattern.exec(text);
    if (m) found.push({ id: rule.id, label: rule.label, match: m[0] });
  }
  return found;
}

const ORG_ID = `${SITE_ORIGIN}/#organisation`;

/** Organisation éditrice (identique à celle de index.html, pour les robots qui n'exécutent pas le JavaScript). */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Selio",
    url: `${SITE_ORIGIN}/`,
    logo: `${SITE_ORIGIN}/icon-512.png`,
    description: `Outils de gestion pour les revendeurs Vinted. ${INDEPENDENCE_NOTICE}`,
  };
}

/**
 * Logiciel présenté par une page : pas de prix (les montants sont indicatifs et
 * vivent sur /tarifs), pas de note ni d'avis (aucun avis client n'est publié).
 */
export function softwareApplicationJsonLd(input: { name: string; path: string; description: string; category?: string }): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: input.name,
    url: `${SITE_ORIGIN}${input.path}`,
    description: input.description,
    applicationCategory: input.category ?? "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "fr-FR",
    publisher: { "@id": ORG_ID },
    isAccessibleForFree: false,
  };
}

/** Fil d'Ariane (accueil → … → page). */
export function breadcrumbJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE_ORIGIN}${it.path}` })),
  };
}

/** Sérialise des données structurées sans permettre de sortir de la balise script. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
