// PDF de synthèse : node pdf.mjs → ../Selio-publicites.pdf
// Planche des visuels, textes clés et plan de campagne (repris de docs/PUBLICITE.md).
// À relancer après build.mjs et textes.mjs (il lit les visuels et les textes).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OUT, ASSET, browser } from "./commun.mjs";
import { META, SEARCH, PMAX, SITE } from "./textes.mjs";
import { CONCEPTS } from "./concepts.mjs";

const V = (rel) => pathToFileURL(join(OUT, "visuels", rel)).href;
const DATE = "20 novembre 2026";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,sans-serif;color:#1C1A24;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:10.5px;line-height:1.5}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;padding:20mm 17mm 18mm}
.page:last-child{page-break-after:auto}
.foot{position:absolute;left:17mm;right:17mm;bottom:9mm;display:flex;justify-content:space-between;font-size:7.5px;color:#6E6A7B}
h2{font-size:18px;font-weight:600;letter-spacing:-.01em;margin:0 0 10px;display:flex;gap:8px;align-items:baseline}
h2 b{color:#6442D6;font-weight:700}
h3{font-size:12px;font-weight:600;margin:14px 0 6px}
p{margin:0 0 7px}
ul{margin:0 0 8px 16px}li{margin:0 0 4px}
.box{border:1px solid #6442D6;background:#F5F2FF;border-radius:8px;padding:12px 16px 8px 30px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:9.5px}
th{background:#F1F0F4;text-align:left;font-weight:500;color:#3a3744;padding:6px 7px}
td{border-bottom:1px solid #E7E5EC;padding:6px 7px;vertical-align:top}
.tag{display:inline-block;font-size:8px;font-weight:600;padding:1px 7px;border-radius:9px;background:#EEF8F1;color:#1d7a46;white-space:nowrap}
.tag.v{background:#F1EDFF;color:#5232B5}.tag.o{background:#FBF4E4;color:#7A591A}
.muted{color:#6E6A7B}
code{font-family:ui-monospace,Menlo,monospace;font-size:8.6px;background:#F1F0F4;padding:1px 4px;border-radius:3px}
.cover{background:radial-gradient(ellipse 70% 50% at 90% 0%,rgba(124,92,235,.35),transparent 70%),linear-gradient(160deg,#121017 0%,#1B1625 45%,#2A2042 100%);color:#EEEBF3;padding:26mm 18mm}
.cover .k{font-size:8.5px;letter-spacing:.25em;color:#B5A3FF;font-weight:600}
.cover h1{font-size:46px;line-height:1.02;letter-spacing:-.03em;margin:46mm 0 8mm;font-weight:700}
.cover h1 em{font-style:normal;color:#E2C67C}
.cover .lead{font-size:13.5px;line-height:1.55;color:#D9D4E2;max-width:125mm}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:30mm}
.stat{border:1px solid #37333F;background:rgba(35,32,42,.6);border-radius:8px;padding:12px 12px 14px}
.stat b{display:block;font-size:22px;color:#B5A3FF;font-weight:700;letter-spacing:-.02em}
.stat small{font-size:8.5px;color:#B4AFC0;line-height:1.4;display:block;margin-top:6px}
.shot{border-radius:6px;display:block;box-shadow:0 2px 10px rgba(28,26,36,.18)}
.cap{font-size:8px;color:#6E6A7B;margin-top:4px}
.q{border-left:3px solid #6442D6;padding:4px 0 4px 10px;margin:0 0 8px;font-size:10.5px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
`;

const foot = (n) => `<div class="foot"><span>Selio · Publicités · ${DATE} · Ibrahim</span><span>${n}</span></div>`;
const shot = (rel, w, cap) => `<div><img class="shot" src="${V(rel)}" style="width:${w}mm">${cap ? `<div class="cap">${cap}</div>` : ""}</div>`;

const pages = [];

// 1. Couverture
pages.push(`<div class="page cover">
  <div class="k">PUBLICITÉS · META ET GOOGLE ADS · ${DATE.toUpperCase()}</div>
  <img src="${ASSET.logoBlanc}" style="height:30px;margin-top:16mm">
  <h1>Les publicités<br><em>de Selio</em></h1>
  <p class="lead">Quatre concepts prêts à téléverser sur Meta, Instagram et Google Ads, leurs textes vérifiés, et un plan de test prudent de trois semaines pour savoir lequel amène des inscriptions au meilleur coût.</p>
  <div class="stats">
    <div class="stat"><b>4</b><small>concepts : Manager, Studio, Bot, Track</small></div>
    <div class="stat"><b>52</b><small>visuels en 15 formats, plus 3 vidéos 16:9</small></div>
    <div class="stat"><b>95</b><small>titres et descriptions Google Search, longueurs vérifiées par script</small></div>
    <div class="stat"><b>450 €</b><small>plafond du test, du 1er au 21 décembre</small></div>
  </div>
  <p style="position:absolute;left:18mm;bottom:16mm;font-size:8.5px;color:#B4AFC0">Réalisé par Ibrahim · pour Elias</p></div>`);

// 2. En bref + formats
const formats = [
  ["Meta, Instagram", "Carré 1080 × 1080 · portrait 1080 × 1350 · story/reel 1080 × 1920 · lien 1200 × 628", "16", "visuels/meta/"],
  ["Google Display (annonces responsives, Performance Max)", "Paysage 1200 × 628 · carré 1200 × 1200 · portrait 960 × 1200, sans texte ajouté", "12", "visuels/google-display/"],
  ["Google bannières (images importées, 150 Ko au plus)", "300 × 250 · 336 × 280 · 728 × 90 · 160 × 600 · 320 × 50", "20", "visuels/google-bannieres/"],
  ["Logos Google", "Carré 1200 × 1200 et paysage 1200 × 300, fond blanc et fond sombre", "4", "visuels/logos/"],
  ["Vidéos 16:9 (YouTube, Performance Max)", "Studio 27 s, négociation 29 s, Track 24 s, vidéo verticale au centre", "3", "videos/"],
];
pages.push(`<div class="page">
  <h2><b>1</b> En bref</h2>
  <div class="box"><ul>
    <li><b>Quatre concepts</b>, un par promesse : <b>A</b> « Toute ton activité Vinted au même endroit » (Manager), <b>B</b> « Tes photos deviennent une annonce » (Studio, exemple du jean Levi's 501), <b>C</b> « Trouve les bonnes affaires avant les autres » (Bot, note sur 100), <b>D</b> « Sache quoi acheter » (Track).</li>
    <li><b>Tout est fait en code</b> à partir des vraies captures de l'application, des photos de démonstration et de cartes dessinées dans le style de l'application ; les chiffres de démonstration sont marqués « exemple ».</li>
    <li><b>Textes</b> : Meta et Instagram (accroches A et B, texte court et long, titre, description, légende avec hashtags), 5 campagnes Google Search par intention (15 titres et 4 descriptions chacune), extensions, Performance Max. Fichier <code>textes.md</code> et import <code>google-ads-editeur.csv</code>.</li>
    <li><b>Test du 1er au 21 décembre</b>, 450 € au plus : Meta 10 €/jour, Google Search 8 €/jour ; on décide sur le coût par inscription, puis par début d'essai.</li>
    <li><b>Règles</b> : aucune promesse de gain, aucun faux avis, aucun logo de Vinted, « Selio est indépendant de Vinted » partout, l'utilisateur garde la main.</li>
  </ul></div>
  <h2 style="margin-top:6mm"><b>2</b> Ce qui est livré</h2>
  <table><tr><th style="width:30%">Usage</th><th>Formats</th><th style="width:8%">Fichiers</th><th style="width:22%">Dossier (livraison/ads/)</th></tr>
  ${formats.map(([a, b, c, d]) => `<tr><td><b>${a}</b></td><td>${b}</td><td>${c}</td><td><code>${d}</code></td></tr>`).join("")}
  <tr><td><b>Textes</b></td><td>Meta, Instagram, Google Search, extensions, Performance Max</td><td>2</td><td><code>textes.md</code>, <code>google-ads-editeur.csv</code></td></tr>
  <tr><td><b>Sources</b></td><td>Pages HTML et scripts : tout se régénère en quelques secondes</td><td>—</td><td><code>source/</code></td></tr></table>
  <h3>Les mêmes concepts en un coup d'œil (format carré)</h3>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${CONCEPTS.map((c) => shot(`meta/selio-${c.key}-${c.slug}-meta-carre-1080x1080.jpg`, 41, `${c.key} · ${c.produit}`)).join("")}</div>
  ${foot(2)}</div>`);

// 3–6. Une page par concept
CONCEPTS.forEach((c, i) => {
  const m = META.find((x) => x.key === c.key);
  const b = `selio-${c.key}-${c.slug}`;
  pages.push(`<div class="page">
    <h2><b>${3 + i}</b> Concept ${c.key} · ${strip(c.title)} <span class="tag v" style="font-size:9px;align-self:center">${c.produit}</span></h2>
    <div style="display:flex;gap:10px;align-items:flex-start">
      ${shot(`meta/${b}-meta-story-1080x1920.jpg`, 52, "Story / reel 1080 × 1920")}
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:10px">${shot(`meta/${b}-meta-carre-1080x1080.jpg`, 58, "Carré 1080 × 1080")}${shot(`meta/${b}-meta-portrait-1080x1350.jpg`, 46.4, "Portrait 1080 × 1350")}</div>
        ${shot(`meta/${b}-meta-lien-1200x628.jpg`, 114.4, "Meta lien 1200 × 628")}
      </div></div>
    <div style="display:flex;gap:10px;align-items:flex-end;margin-top:6px">
      ${shot(`google-display/${b}-display-paysage-1200x628.jpg`, 62, "Google Display 1200 × 628 (sans texte)")}
      ${shot(`google-bannieres/${b}-banniere-300x250.jpg`, 36, "300 × 250")}
      ${shot(`google-bannieres/${b}-banniere-160x600.jpg`, 14.4, "160 × 600")}
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">${shot(`google-bannieres/${b}-banniere-728x90.jpg`, 52, "728 × 90")}${shot(`google-bannieres/${b}-banniere-320x50.jpg`, 30, "320 × 50")}</div></div>
    <h3>Textes clés Meta (tutoiement)</h3>
    <div class="grid2"><div>
      <div class="q"><b>Accroche A</b> · ${esc(m.accroches[0])}</div><div class="q"><b>Accroche B</b> · ${esc(m.accroches[1])}</div></div><div>
      <div class="q"><b>Texte court</b> · ${esc(m.court)}</div>
      <div class="q"><b>Titre</b> · ${esc(m.titre)} · <b>Description</b> · ${esc(m.description)} · <b>Bouton</b> · ${m.cta}</div></div></div>
    <p class="muted">Page d'arrivée : <code>${SITE}${m.page}</code> · le texte long, la légende Instagram et les hashtags sont dans <code>textes.md</code>.</p>
    ${foot(3 + i)}</div>`);
});

// 7. Google Ads Search + PMax
pages.push(`<div class="page">
  <h2><b>7</b> Google Ads : Search et Performance Max</h2>
  <p>Cinq campagnes Search, une par intention de recherche, vouvoiement comme la vitrine. Chaque annonce responsive a <b>15 titres (≤ 30 caractères)</b> et <b>4 descriptions (≤ 90)</b>, vérifiés par <code>node textes.mjs</code> ; « Vinted » figure dans 4 titres au plus, pour que l'annonce tienne même si l'usage de la marque est restreint.</p>
  <table><tr><th style="width:22%">Campagne</th><th style="width:22%">URL finale · chemin</th><th>Exemples de titres</th><th style="width:24%">Mots-clés exacts (extrait)</th></tr>
  ${SEARCH.map((c) => `<tr><td><b>${esc(c.campagne.replace("Search · ", ""))}</b></td><td><code>${c.page}</code><br><span class="muted">/${c.path1}/${c.path2}</span></td><td>${c.titres.slice(0, 5).map(esc).join(" · ")}</td><td>${c.exact.slice(0, 4).map((k) => `[${esc(k)}]`).join(" ")}</td></tr>`).join("")}</table>
  <h3>Description type (dans chaque campagne)</h3>
  <div class="q">${esc(SEARCH[0].descriptions[3])}</div>
  <h3>Extensions et négatifs</h3>
  <p>Six liens annexes (Manager, Studio, Track, Bot, Négociation, Tarifs), huit accroches (« Essai gratuit 14 jours », « Rien débité avant la fin », « Résiliable à tout moment »…), extraits « Services » et « Types ». Une liste partagée de négatifs écarte les recherches de connexion, de service client, de colis, d'emploi, et les requêtes de navigation vers Vinted.</p>
  <h3>Performance Max (à partir de janvier, avec 30 conversions sur 30 jours)</h3>
  <table><tr><th style="width:16%">Groupe</th><th>Titre long</th><th style="width:30%">Description courte (≤ 60)</th></tr>
  ${PMAX.groupes.map((g) => `<tr><td><b>${g.nom}</b></td><td>${esc(g.longs[0])}</td><td>${esc(g.descriptions[0])}</td></tr>`).join("")}</table>
  <p class="muted">Images : <code>visuels/google-display/</code> (1,91:1, 1:1, 4:5) · logos : <code>visuels/logos/</code> · vidéos : <code>../video/*.mp4</code> (9:16) et <code>videos/*-16x9.mp4</code>.</p>
  ${foot(7)}</div>`);

// 8. Plan : budget, ciblage, structure
pages.push(`<div class="page">
  <h2><b>8</b> Le plan de test</h2>
  <h3>Budget (1er – 21 décembre)</h3>
  <table><tr><th>Poste</th><th>Par jour</th><th>3 semaines</th><th>Remarque</th></tr>
  <tr><td>Meta (Facebook, Instagram)</td><td>10 €</td><td>210 €</td><td>Budget de campagne, 4 publicités</td></tr>
  <tr><td>Google Search, 5 campagnes</td><td>8 €</td><td>168 €</td><td>Annonce IA 2 €, Multi-comptes 2 €, Négociation 1,50 €, Prix 1,50 €, Bot 1 €</td></tr>
  <tr><td>Remarketing Display (3e semaine)</td><td>2 €</td><td>14 €</td><td>Si la liste des visiteurs atteint 100 personnes</td></tr>
  <tr><td>Réserve</td><td>—</td><td>58 €</td><td>Renfort du meilleur concept la 3e semaine</td></tr>
  <tr><td><b>Total</b></td><td><b>≈ 20 €</b></td><td><b>450 €</b></td><td>Ordre de grandeur du budget de départ de la stratégie V1</td></tr></table>
  <p class="muted">Décembre coûte plus cher (fêtes) : le test donne des ordres de grandeur. Hausse de budget : 20 % au plus, tous les 3 à 4 jours.</p>
  <h3>Ciblage</h3>
  <ul><li><b>France, français.</b> Belgique et Suisse francophones plus tard.</li>
  <li><b>Meta</b> : 18 – 54 ans, audience Advantage+ avec suggestions (seconde main, friperie, vintage, achat-revente, entrepreneuriat), placements Advantage+ avec le bon format par placement ; exclusion des inscrits.</li>
  <li><b>Google Search</b> : exact et expression seulement, Réseau de Recherche seul ; <b>Display</b> : remarketing des visiteurs non inscrits (30 jours), 3 affichages par jour au plus.</li></ul>
  <h3>Structure</h3>
  <table><tr><th style="width:18%">Plateforme</th><th>Campagnes et groupes</th><th style="width:28%">Enchères</th></tr>
  <tr><td><b>Meta</b></td><td>« Selio · Test concepts », objectif Ventes optimisé sur l'inscription ; un ensemble de publicités ; 4 publicités (A, B, C, D) avec carré, story et lien</td><td>Budget de campagne Advantage, coût le plus bas</td></tr>
  <tr><td><b>Google Search</b></td><td>5 campagnes, 1 groupe et 1 annonce responsive chacune ; liste de négatifs partagée ; extensions au niveau du compte</td><td>Maximiser les clics (CPC max 0,80 €), puis Maximiser les conversions dès 15 conversions</td></tr>
  <tr><td><b>Google Display</b></td><td>Remarketing (3e semaine) : bannières et images responsives</td><td>Maximiser les conversions</td></tr>
  <tr><td><b>Performance Max</b></td><td>Janvier : 1 campagne, 4 groupes d'éléments</td><td>Avec 30 conversions sur 30 jours</td></tr></table>
  <h3>Suivi des conversions</h3>
  <p>Le site charge déjà Google tag et le pixel Meta <b>après consentement</b> (bandeau CNIL, mode Consentement v2) ; il reste à renseigner les identifiants au build Netlify (<code>VITE_GOOGLE_ADS_ID</code>, <code>VITE_GOOGLE_ADS_SIGNUP_LABEL</code>, <code>VITE_GOOGLE_ADS_TRIAL_LABEL</code>, <code>VITE_META_PIXEL_ID</code>).</p>
  <table><tr><th>Événement</th><th>Meta</th><th>Google Ads</th><th>Rôle</th></tr>
  <tr><td>Inscription (compte créé)</td><td><code>CompleteRegistration</code></td><td>« Inscription »</td><td><span class="tag">existe</span> principale pendant le test</td></tr>
  <tr><td>Clic vers l'essai</td><td><code>ClicEssai</code></td><td>« Clic essai »</td><td><span class="tag">existe</span> observation</td></tr>
  <tr><td>Début d'essai (carte enregistrée)</td><td><code>StartTrial</code> (API Conversions)</td><td>import (gclid)</td><td><span class="tag o">à ajouter</span> principale dès qu'elle existe</td></tr>
  <tr><td>Abonnement payé</td><td><code>Subscribe</code> avec valeur</td><td>import hors ligne</td><td><span class="tag o">à ajouter</span> coût par client</td></tr></table>
  ${foot(8)}</div>`);

// 9. Calendrier, indicateurs, points d'attention
pages.push(`<div class="page">
  <h2><b>9</b> Calendrier des tests et indicateurs</h2>
  <table><tr><th style="width:17%">Semaine</th><th>Meta</th><th>Google</th></tr>
  <tr><td><b>23 – 30 nov.</b><br><span class="muted">préparation</span></td><td>Compte publicitaire, page et Instagram reliés, domaine vérifié, pixel et API Conversions, audience d'exclusion</td><td>Compte, balise, conversions, import du CSV, négatifs, extensions ; vérifier les 5 pages d'arrivée en ligne</td></tr>
  <tr><td><b>1er – 7 déc.</b></td><td>Les 4 concepts face à face (même accroche, mêmes formats)</td><td>Les 5 campagnes ; termes de recherche lus 2 fois par semaine</td></tr>
  <tr><td><b>8 – 14 déc.</b></td><td>Les 2 meilleurs concepts ; accroche A contre B (outil « Test A/B »)</td><td>Couper les mots-clés à plus de 15 € sans inscription ; budget vers les 2 meilleures campagnes</td></tr>
  <tr><td><b>15 – 21 déc.</b></td><td>Image fixe contre vidéo 9:16 sur le meilleur concept</td><td>Maximiser les conversions si 15 conversions ; remarketing Display</td></tr>
  <tr><td><b>22 déc.</b></td><td colspan="2">Bilan et décision : continuer, augmenter ou arrêter. Une variante n'est jugée qu'après 1 000 impressions et 50 clics, ou deux fois le coût visé dépensé.</td></tr></table>
  <h3>Indicateurs (revue chaque lundi, avec celle des réseaux)</h3>
  <table><tr><th>Indicateur</th><th>Seuil d'alerte</th><th>Visé (hypothèse)</th></tr>
  <tr><td>CTR Meta (clics sur le lien)</td><td>&lt; 0,6 % après 2 000 impressions</td><td>≥ 1 %</td></tr>
  <tr><td>CTR Search</td><td>&lt; 3 %</td><td>≥ 5 %</td></tr>
  <tr><td>CPC Search</td><td>&gt; 1,20 €</td><td>≤ 0,80 €</td></tr>
  <tr><td>Coût par inscription</td><td>&gt; 30 €</td><td>≤ 15 €</td></tr>
  <tr><td>Coût par début d'essai</td><td>&gt; 60 €</td><td>≤ 30 €</td></tr>
  <tr><td>Inscription → début d'essai</td><td>&lt; 30 % (regarder la page, pas la publicité)</td><td>≥ 50 %</td></tr>
  <tr><td>Répétition Meta</td><td>&gt; 3 par semaine</td><td>≤ 2</td></tr></table>
  <p class="muted">Repère final : moins de 100 € de coût d'acquisition par client payant (plan réseaux).</p>
  <h2 style="margin-top:7mm"><b>10</b> Points d'attention</h2>
  <ul>
    <li><b>« Vinted » dans les annonces Google</b> : possible tant que Vinted ne s'y oppose pas ; sinon les 11 titres sans la marque suffisent. Aucun logo, aucune couleur, aucune capture de Vinted dans les visuels.</li>
    <li><b>Marques d'articles</b> : Levi's (exemple du concept B) et l'étiquette Tommy Hilfiger de la vidéo Studio. Jamais dans un texte Google ; en cas de refus d'un visuel, en retirer le nom (une ligne dans <code>source/concepts.mjs</code>).</li>
    <li><b>Prix indicatifs</b> : absents des publicités tant qu'ils ne sont pas définitifs. <b>L'essai demande une carte</b> : la page d'arrivée doit le dire avant l'inscription.</li>
    <li><b>Selio Cloud et l'achat automatique</b> restent fermés : les publicités parlent de l'extension et de l'achat validé en 1 clic.</li>
    <li><b>Domaine</b> : <code>seliovprod.netlify.app</code> fonctionne ; un domaine à soi inspirera plus confiance avant d'augmenter les budgets.</li>
  </ul>
  <p class="muted" style="margin-top:8mm">Réalisé par Ibrahim · ${DATE}</p>
  ${foot(9)}</div>`);

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Selio — Publicités</title><style>${CSS}</style></head><body>${pages.join("")}</body></html>`;
const tmp = join(OUT, "source", ".pdf.html");
writeFileSync(tmp, html);
const b = await browser();
const p = await b.newPage();
await p.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
await p.evaluate(async () => { await document.fonts.ready; });
await p.pdf({ path: join(OUT, "Selio-publicites.pdf"), format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await b.close();
(await import("node:fs")).unlinkSync(tmp);
console.log("Selio-publicites.pdf écrit.");
