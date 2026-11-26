import { useEffect } from "react";
import { PLAN_OFFERS, PRICING, TRIAL_OFFER } from "@selio/demo-data";
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
  /** Image de partage (1200 × 630, sous public/og/) ; par défaut celle du site. */
  ogImage?: string;
  /**
   * Page d'atterrissage publicitaire non indexée : « noindex, follow » (les liens restent suivis),
   * au lieu du « noindex, nofollow » des pages légales et de connexion.
   */
  noindexFollow?: boolean;
}

/** Image de partage par défaut (Open Graph, Twitter), 1200 × 630. */
export const DEFAULT_OG_IMAGE = "/og/selio.jpg";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** Les pages publiques de la vitrine (hors connexion, inscription, liens reçus par email). */
export const SEO_PAGES: readonly SeoPage[] = [
  { path: "/", title: "Selio — Logiciel de gestion pour revendeurs Vinted", description: "Outil revendeur Vinted : Selio Manager gère stock, messages, négociation, commandes et étiquettes. Essai gratuit 14 jours, automatisations au rythme humain.", indexable: true, priority: 1 },
  { path: "/fonctionnalites", title: "Fonctionnalités du logiciel Vinted", description: "Les quatorze modules de Selio et leur état réel : générateur d'annonces, dressing noté sur 100, négociation, stock, commandes, analyses et automatisations.", indexable: true, priority: 0.8 },
  { path: "/plateforme", title: "Les cinq filiales Selio : Manager, Studio, Track, Bot, Compte", description: "Selio Manager (avec Selio Cloud et Selio Agent), Selio Studio, Selio Track, Selio Bot et Selio Compte : les cinq filiales Selio, chacune avec son état réel.", indexable: true, priority: 0.8 },
  { path: "/produits/manager", title: "Selio Manager — gestion et automatisation Vinted", description: "Stock, dressing, remise en ligne, messages, négociation par IA, relances, commandes, marges et multi-comptes : gestion Vinted complète, Cloud et Agent intégrés.", indexable: true, priority: 0.9 },
  { path: "/produits/studio", title: "Selio Studio — annonces Vinted créées par l'IA", description: "Titres optimisés, descriptions détaillées et meilleure présentation à partir de vos photos, sans valeur inventée : du temps gagné à chaque annonce.", indexable: true, priority: 0.9 },
  { path: "/produits/track", title: "Selio Track — analyse du marché Vinted", description: "Niches, suivi du marché, produits similaires et prix de revente estimés : Track repère les opportunités avant l'achat ou la vente. Il n'achète pas.", indexable: true, priority: 0.8 },
  { path: "/produits/bot", title: "Selio Bot — recherche et achat d'articles Vinted", description: "Recherche selon vos critères, alertes, bonnes affaires notées sur 100, revente et marge estimées, limites de dépenses, achat rapide ou automatisé.", indexable: true, priority: 0.8 },
  { path: "/produits/compte", title: "Selio Compte — comptes Vinted et accompagnement", description: "Création de comptes Vinted, configuration de Selio Manager, messages et négociation optimisés, accompagnement 30 jours, aide en cas de restriction.", indexable: true, priority: 0.7 },
  { path: "/produits/cloud", title: "Selio Cloud — automatisation Vinted ordinateur éteint", description: "Fonctionnalité de Selio Manager : certaines automatisations tournent à distance, ordinateur éteint, au rythme humain et avec votre accord, compte par compte.", indexable: true, priority: 0.6 },
  { path: "/produits/agent", title: "Selio Agent — déléguer tâches et accès Vinted", description: "Fonctionnalité de Selio Manager : tâches et accès délégués à vos collaborateurs et prestataires, chacun son identifiant, aucun mot de passe partagé.", indexable: true, priority: 0.6 },
  { path: "/selio-ou-bleam", title: "Selio ou Bleam ? Comparatif pour revendeurs Vinted", description: "Selio ou Bleam : ce que fait chaque outil revendeur Vinted, avec les sources. Fonctions, principes, données et migration sans identifiants.", indexable: COMPARISON_READY, priority: 0.7 },
  { path: "/alternative-bleam", title: "Alternative à Bleam, V-Tools ou Clemz — Selio", description: "Une alternative à Bleam, V-Tools ou Clemz pour gérer et automatiser Vinted : stock, négociation, marges, sans mot de passe ni contournement.", indexable: COMPARISON_READY, priority: 0.7 },
  { path: "/extension", title: "Extension navigateur pour Vinted", description: "L'extension Selio capture un article visible vers votre stock et prépare une réponse depuis une conversation ouverte. Vous confirmez chaque action.", indexable: true, priority: 0.7 },
  { path: "/extension/confidentialite", title: "Confidentialité de l'extension", description: "Ce que l'extension Selio lit, ce qu'elle envoie à Selio et ce qu'elle ne collecte jamais (version provisoire, définitive après l'avocat).", indexable: false, priority: 0.3 },
  { path: "/assistant-ia", title: "Assistant IA", description: "L'assistant Selio rédige, vos règles décident : prix plancher, marge minimale, horaires et limites par acheteur restent déterministes.", indexable: true, priority: 0.6 },
  { path: "/tarifs", title: "Tarifs", description: "Essai gratuit de 14 jours, offres Starter, Pro et Agence pour 1, 3 ou 10 comptes Vinted, Selio Bot au mois, Selio Compte à la prestation. Montants indicatifs.", indexable: true, priority: 0.8 },
  { path: "/faq", title: "Aide et FAQ", description: "Les questions fréquentes sur Selio : essai, comptes Vinted, extension, IA, dressing, achats, négociation, équipe, tarifs et données.", indexable: true, priority: 0.6 },
  { path: "/contact", title: "Contact", description: "Contacter l'équipe Selio : question produit, devis Selio Compte, présentation guidée, signalement.", indexable: true, priority: 0.4 },
  // Pages d'atterrissage publicitaires (une intention de recherche chacune, voir landings.ts).
  // Indexées quand le sujet n'a pas déjà sa page ; sinon « noindex, follow » (doublon d'une page produit).
  { path: "/logiciel-vinted", title: "Logiciel Vinted multi-comptes : tous vos comptes au même endroit", description: "Selio Manager, le logiciel Vinted des revendeurs : comptes, stock, messages, commandes et marges au même endroit. Essai gratuit 14 jours, sans carte.", indexable: true, priority: 0.8, ogImage: "/og/logiciel-vinted.jpg" },
  { path: "/negociation-automatique-vinted", title: "Négociation automatique Vinted selon vos prix planchers", description: "Offres Vinted acceptées, refusées ou contre-proposées selon votre prix plancher et vos marges : vos règles décident, l'IA rédige. Essai gratuit 14 jours.", indexable: true, priority: 0.7, ogImage: "/og/negociation-automatique-vinted.jpg" },
  { path: "/annonce-vinted-ia", title: "Annonce Vinted par IA : titre et description depuis vos photos", description: "Vos photos deviennent une annonce Vinted : titre optimisé, description détaillée, étiquette lue, aucune valeur inventée. Essai gratuit 14 jours.", indexable: false, noindexFollow: true, priority: 0.5, ogImage: "/og/annonce-vinted-ia.jpg" },
  { path: "/prix-revente-vinted", title: "Prix de revente Vinted : estimer avant d'acheter ou de vendre", description: "Estimez le prix de revente d'un article Vinted : fourchette, produits similaires, délai de vente estimé et niches à forte demande, avec Selio Track.", indexable: false, noindexFollow: true, priority: 0.5, ogImage: "/og/prix-revente-vinted.jpg" },
  { path: "/bot-achat-vinted", title: "Bot d'achat Vinted : bonnes affaires notées sur 100 et alertes", description: "Selio Bot surveille Vinted selon vos critères, note chaque affaire sur 100 avec sa marge estimée et vous alerte, dans vos limites de dépenses.", indexable: false, noindexFollow: true, priority: 0.5, ogImage: "/og/bot-achat-vinted.jpg" },
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

/** Pose (ou crée) une balise meta du document. */
function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Titre, description et indexation d'une page de la vitrine, depuis la liste ci-dessus ; plus
 * l'adresse canonique sur le domaine public (sans paramètres de campagne : gclid, utm…), l'aperçu
 * de partage Open Graph et Twitter (image 1200 × 630) et, pour une page d'atterrissage doublon,
 * « noindex, follow ».
 */
export function useMarketingMeta(path: string, overrides: { description?: string } = {}) {
  const page = seoPage(path);
  const description = overrides.description ?? page.description;
  usePageMeta(page.title, description, { noindex: !page.indexable });
  useEffect(() => {
    const url = `${SITE_ORIGIN}${path === "/" ? "/" : path}`;
    const image = `${SITE_ORIGIN}${page.ogImage ?? DEFAULT_OG_IMAGE}`;
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;
    if (page.noindexFollow) setMeta("name", "robots", "noindex, follow");
    setMeta("property", "og:url", url);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:image", image);
    setMeta("property", "og:image:width", String(OG_IMAGE_SIZE.width));
    setMeta("property", "og:image:height", String(OG_IMAGE_SIZE.height));
    setMeta("property", "og:image:alt", page.title);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", document.title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
  }, [path, page, description]);
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

const euros = (cents: number) => (cents / 100).toFixed(2);

/**
 * Prix affichés ou masqués (VITE_SHOW_INDICATIVE_PRICING, même règle que lib/env.ts) : lu ici sans
 * importer lib/env.ts, pour que ce module reste utilisable hors de Vite (tests de bout en bout).
 */
export const SHOW_INDICATIVE_PRICING: boolean = (import.meta.env as Record<string, unknown> | undefined)?.VITE_SHOW_INDICATIVE_PRICING !== "false";

/**
 * Les offres réelles de Selio (essai, Starter, Pro, Agence), lues dans PRICING
 * (@selio/demo-data) : jamais un montant en dur ici. Vide quand l'affichage des prix est
 * masqué (VITE_SHOW_INDICATIVE_PRICING=false), comme sur la page Tarifs.
 */
export function selioOffersJsonLd(show: boolean = SHOW_INDICATIVE_PRICING): Record<string, unknown>[] {
  if (!show) return [];
  const url = `${SITE_ORIGIN}/tarifs`;
  return [
    { "@type": "Offer", name: TRIAL_OFFER.name, price: "0", priceCurrency: PRICING.currency, url, description: TRIAL_OFFER.tagline },
    ...PLAN_OFFERS.map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: euros(p.indicativeMonthlyCents),
      priceCurrency: PRICING.currency,
      url,
      description: p.forWhom,
      priceSpecification: { "@type": "UnitPriceSpecification", price: euros(p.indicativeMonthlyCents), priceCurrency: PRICING.currency, billingDuration: "P1M", unitText: "mois" },
    })),
  ];
}

/**
 * Logiciel présenté par une page. Pas de note ni d'avis (aucun avis client n'est publié). Les
 * prix (`offers: true`) ne figurent que sur les pages qui parlent de l'abonnement (accueil,
 * tarifs, pages d'atterrissage de Selio Manager), lus dans PRICING.
 */
export function softwareApplicationJsonLd(input: { name: string; path: string; description: string; category?: string; offers?: boolean }): Record<string, unknown> {
  const offers = input.offers ? selioOffersJsonLd() : [];
  return {
    ...(offers.length ? { offers } : {}),
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

/** Questions fréquentes d'une page (FAQPage) : les mêmes questions que celles affichées. */
export function faqPageJsonLd(items: readonly { question: string; answer: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({ "@type": "Question", name: it.question, acceptedAnswer: { "@type": "Answer", text: it.answer } })),
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
