/* Films par filiale (30 à 45 s), pour les comptes dédiés. Faits : apps/web/src/app/spaces/spaces.tsx et docs/RADAR, TRACK, STUDIO, CLOUD. */
const titleCard = (name, tagline, dur = 3.2) => ({ dur, html: `<div class="flash"${an(0, "flash", 0.7, "--ez:ease-out")}></div>${sfx("impact", 0)}${sfx("sparkle", 0, 0.9)}
  <div style="position:absolute;left:340px;top:520px">${logo(0.05, 400)}</div>
  <div class="cap slam" style="--top:690px;--fs:${name.length > 8 ? 150 : 190}px"><div${an(0.35, "slam", 0.45, "color:#E2C67C")}>${name}</div></div>${sfx("slam", 0.35, 1)}
  <div class="cap" style="--top:960px;--fs:62px"><div${an(0.9, "up", 0.5)}>${capWords(tagline, 1.0, 0.1)}</div></div>` });
const TXT = `<div class="ov tf" style="left:24px;top:467px;width:551px;height:89px">${TITRE}</div><div class="ov tf small" style="left:24px;top:616px;width:551px;height:178px">${DESC}</div>`;
const NOTIF82 = ["Affaire Radar : Pull Tommy Hilfiger femme à pois", "4,00 € · note 82 · revente estimée 13,50 €"];

reg("50-film-radar", { formats: V, build: () => { const C = "Selio Radar"; return seq([
  titleCard("Radar", "Les bonnes affaires,\n*sans surveiller Vinted.*"),
  demo({ dur: 6.8, keep: true, chip: C, page: "radar",
    caps: [[0.3, 3.0, "Tu décris ce que\n*tu cherches* :"], [3.2, 6.7, "marque, catégorie, taille,\nétat, *prix maximum.*", { fs: 76 }]],
    ov: hl(3.4, 20, 458, 560, 56) + hl(3.8, 20, 548, 560, 56) + hl(4.2, 20, 638, 560, 56) + hl(4.6, 20, 728, 560, 56) + hl(5.1, 20, 818, 560, 96),
    extra: fchip(5.4, 6.7, 770, 1700, "Prix d'achat maximum", "conseillé par Track", "shield") }),
  demo({ dur: 6.6, keep: true, chip: C, page: "radar", enter: false, scroll: [[0.3, 330, 1.1]],
    caps: [[0.2, 3.1, "Chaque annonce reçoit\n*une note sur 100.*"], [3.3, 6.5, "Tu choisis à partir de\nquelle note *il t'alerte.*", { fs: 78 }]],
    ov: hl(3.7, 20, 1006, 560, 112) + hl(5.0, 20, 1180, 560, 62),
    extra: fchip(4.0, 6.5, 770, 1700, "Alerte à partir de", "80 / 100", "bell", true) }),
  demo({ dur: 3.4, keep: true, chip: C, page: "radar", enter: false, scroll: [[-20, 330, 0.01]],
    caps: [[0.2, 3.3, "*82* : ton\ntéléphone sonne."]], extra: notif(0.25, 3.2, 600, ...NOTIF82) }),
  demo({ dur: 7.2, keep: true, chip: C, page: "deal", enter: false, scroll: [[1.0, 300, 1.1]],
    caps: [[0.2, 2.4, "L'affaire est prête :"], [2.6, 5.0, "le coût réel, port et\n*protection compris,*", { fs: 78 }], [5.2, 7.1, "la revente estimée,"]],
    ov: hl(3.0, 20, 884, 560, 184, 5.1) + hl(5.4, 20, 1116, 560, 90) }),
  demo({ dur: 6.6, chip: C, page: "deal", enter: false, scroll: [[-20, 300, 0.01], [0.3, 200, 1.0]],
    caps: [[0.2, 3.1, "et ton\n*vrai bénéfice.*"], [3.3, 6.5, "Tu ouvres l'annonce,\n*c'est toi qui achètes.*"]],
    ov: hl(1.3, 20, 1268, 560, 156, 3.3) + hl(3.7, 22, 1458, 556, 70) + tapS(4.5, 300, 1491),
    extra: fchip(1.6, 3.2, 770, 1700, "Bénéfice estimé", "+5,70 €", "coin", true) }),
  typo({ dur: 5.8, chip: C, caps: [[0.2, 5.7, "Selio Radar,\n*en bref.*"]], t0: 0.8, step: 0.6,
    rows: [["Une note sur 100 par annonce"], ["Une alerte sur ton téléphone"], ["Le coût réel et le bénéfice estimé"], ["Tu achètes toi-même, en un clic"]] }),
  { dur: 4.4, html: endCard("Les bonnes affaires\n*viennent à toi.*", 1) },
]); } });

reg("51-film-track", { formats: V, build: () => { const C = "Selio Track"; return seq([
  titleCard("Track", "Sourcer au bon endroit,\n*au bon prix.*"),
  demo({ dur: 6.8, keep: true, chip: C, page: "track",
    caps: [[0.3, 3.1, "Combien ça se revend,\n*vraiment ?*"], [3.3, 6.7, "Track regarde les\n*ventes observées.*"]],
    ov: hl(3.7, 20, 366, 560, 392), extra: fchip(4.1, 6.7, 770, 1700, "Ventes observées", "48", "chart") }),
  demo({ dur: 6.6, keep: true, chip: C, page: "track", enter: false,
    caps: [[0.2, 3.0, "Revente moyenne :\n*13 à 14 €.*"], [3.2, 6.5, "Achat maximum conseillé :\n*5,00 €.*", { fs: 76 }]],
    ov: hl(0.8, 190, 420, 250, 110, 3.1) + hl(3.6, 298, 772, 282, 162),
    extra: fchip(4.0, 6.5, 300, 1700, "Pour garder", "ta marge", "shield", true) }),
  demo({ dur: 6.4, keep: true, chip: C, page: "track", enter: false, scroll: [[0.3, 280, 1.0]],
    caps: [[0.2, 3.0, "Les comparables\nrécents,"], [3.2, 6.3, "*sans aucun pseudo.*\nDes statistiques, c'est tout.", { fs: 74 }]],
    ov: hl(1.2, 20, 1040, 560, 236, 3.1) + hl(3.6, 20, 1278, 560, 46) }),
  demo({ dur: 4.8, chip: C, page: "track", enter: false, scroll: [[-20, 280, 0.01]],
    caps: [[0.2, 4.7, "Un clic : ta recherche\n*part dans le Radar.*"]],
    ov: hl(0.9, 22, 952, 556, 72) + tapS(1.4, 300, 987),
    extra: fchip(1.9, 4.7, 540, 1720, "Recherche Radar", "créée depuis Track", "bell", true) }),
  typo({ dur: 6, chip: C, caps: [[0.2, 5.9, "Et aussi :"]], t0: 0.7, step: 0.6,
    rows: [["Des filtres suivis sur 30 jours"], ["Des niches notées sur 100"], ["Un prix estimé depuis une photo"], ["Avec les offres Pro et Agence"]] }),
  { dur: 4.4, html: endCard("Achète au bon prix,\n*avant d'acheter.*", 1) },
]); } });

reg("52-film-studio", { formats: V, build: () => { const C = "Selio Studio"; return seq([
  titleCard("Studio", "Tes photos deviennent\n*des annonces.*"),
  demo({ dur: 6.4, keep: true, chip: C, page: "studio",
    caps: [[0.3, 3.0, "Trois étapes,\n*c'est tout.*"], [3.2, 6.3, "Tes photos, l'IA rédige,\n*tu choisis.*", { fs: 78 }]],
    ov: hl(3.4, 14, 500, 572, 62) + hl(4.2, 14, 566, 572, 62) + hl(5.0, 14, 632, 572, 62) }),
  demo({ dur: 5.8, keep: true, chip: C, page: "studio", enter: false, scroll: [[0.3, 560, 1.2]],
    caps: [[0.2, 2.7, "Face, dos, étiquette,\ndéfauts :"], [2.9, 5.7, "*3 à 8 photos,*\ndéposées d'un coup."]],
    ov: hl(1.7, 66, 862, 470, 262), extra: fchip(3.3, 5.7, 770, 1690, "Photos lues", "6 sur 6", "cam") }),
  demo({ dur: 6.8, keep: true, chip: C, page: "studiolisting", enter: false,
    caps: [[0.2, 3.0, "*Le titre* s'écrit,"], [3.2, 6.7, "*la description* aussi."]],
    ov: `<div class="ov tf" style="left:24px;top:467px;width:551px;height:89px">${type(TITRE, 0.5, 34)}</div><div class="ov tf small" style="left:24px;top:616px;width:551px;height:178px">${type(DESC, 3.2, 70)}</div>` }),
  demo({ dur: 6.2, keep: true, chip: C, page: "studiolisting", enter: false, scroll: [[0.3, 330, 1.1]],
    caps: [[0.2, 3.2, "Marque, taille, catégorie,\nétat, couleur, matière :", { fs: 74 }], [3.4, 6.1, "*remplis pour toi.*", { slam: true, fs: 110 }]],
    ov: TXT + hl(1.6, 20, 850, 560, 76) + hl(2.0, 20, 987, 560, 76) + hl(2.4, 20, 1124, 560, 76) }),
  demo({ dur: 6.8, chip: C, page: "studiolisting", enter: false, scroll: [[-20, 330, 0.01]],
    caps: [[0.2, 3.1, "Le prix conseillé vient\n*des ventes comparables.*", { fs: 78 }], [3.3, 6.7, "Brouillon ou publication :\n*rien sans ton clic.*", { fs: 78 }]],
    ov: TXT + hl(0.9, 20, 1243, 560, 78, 3.2) + hl(3.7, 20, 1334, 560, 76) + hl(4.5, 14, 1416, 330, 38),
    extra: fchip(1.3, 3.1, 770, 1720, "Prix conseillé", "14,00 €", "tag", true) }),
  { dur: 4.4, html: endCard("Publie plus vite,\n*et mieux.*", 2) },
]); } });

reg("53-film-gestion", { formats: V, build: () => { const C = "Selio Gestion"; return seq([
  titleCard("Gestion", "Ton activité Vinted,\n*au même endroit.*"),
  demo({ dur: 6.4, chip: "Dressing", page: "vdressing", hd: 208,
    caps: [[0.3, 3.0, "Ton dressing,\n*noté sur 100.*"], [3.2, 6.3, "Tu sais quoi\n*republier.*"]],
    ov: bd(1.2, 40, 313, 90, true) + bd(1.45, 326, 313, 72) + bd(1.7, 40, 752, 64) + bd(1.95, 326, 752, 58),
    extra: fchip(3.6, 6.3, 770, 1700, "Note du pull", "90 / 100", "star", true) }),
  demo({ dur: 7, chip: "Négociation", page: "nego",
    caps: [[0.3, 3.0, "Une offre\n*trop basse ?*"], [3.2, 6.9, "La contre-offre respecte\n*ton prix plancher.*", { fs: 78 }]],
    ov: hl(1.0, 18, 438, 474, 142, 3.1) + `<div class="ov msgbox"${an(3.5, "up", 0.45, "left:24px;top:612px;width:552px")}><div class="msg">Bonjour Léa, merci pour ton offre ! Je peux te le laisser à 12,50 €, envoi dès demain.<span class="t">Négociation automatique · 20:04</span></div></div>${sfx("swish", 3.5)}`,
    extra: fchip(4.2, 6.9, 320, 1690, "Prix plancher", "11,50 € respecté", "shield", true) }),
  demo({ dur: 6.4, chip: "Automatisation", page: "autohub", scroll: [[0.6, 430, 1.3]],
    caps: [[0.3, 3.1, "Favoris, réponses,\nnégociation, après-vente :", { fs: 76 }], [3.3, 6.3, "*tu actives ce que tu veux.*", { fs: 80 }]],
    ov: hl(2.2, 448, 631, 104, 42) + hl(2.6, 448, 949, 104, 42) + hl(3.0, 448, 1267, 104, 42) }),
  demo({ dur: 6, chip: "Commandes", page: "orders", scroll: [[0.6, 330, 1.2]],
    caps: [[0.3, 3.0, "Chaque vente crée\n*sa commande,*"], [3.2, 5.9, "bordereau compris."]],
    ov: hl(2.0, 20, 668, 560, 70), extra: fchip(3.5, 5.9, 770, 1690, "Bordereau", "prêt à l'avance", "box", true) }),
  demo({ dur: 6.4, chip: "Analyses", page: "analytics", scroll: [[3.4, 430, 1.3]],
    caps: [[0.3, 3.1, "Et tes marges,\n*au centime près.*"], [3.3, 6.3, "Chiffre d'affaires, marge,\n*rotation du stock.*", { fs: 76 }]],
    ov: hl(1.2, 22, 700, 278, 190) + hl(1.6, 300, 700, 276, 190) }),
  { dur: 4.4, html: endCard(APPLI, 0) },
]); } });

reg("54-film-cloud", { formats: V, build: () => { const C = "Selio Cloud · aperçu"; return seq([
  titleCard("Cloud", "Tes automatisations,\n*même ordinateur éteint.*"),
  { dur: 6.8, html: `${chip(C)}${caps([[0.3, 3.1, "Ton ordinateur\n*est éteint ?*"], [3.3, 6.7, "Tes réponses et tes relances\n*continuent.*", { fs: 76 }]])}
      <div style="position:absolute;inset:0;perspective:1800px"><div${an(0.2, "phoneIn", 0.9, "position:absolute;left:260px;top:600px")}><div class="cc loop" style="position:relative;width:560px;height:1212px;border-radius:72px;border-width:5px;--an:floatP;--du:5s"><img src="${ECR}thumb-cloud.jpg"></div></div></div>${sfx("whoosh", 0.2)}` },
  typo({ dur: 7.4, chip: C, caps: [[0.2, 3.4, "Tu te connectes\n*toi-même.*"], [3.6, 7.3, "Ton mot de passe, Selio\n*ne le voit jamais.*", { fs: 80 }]],
    t0: 3.9, y: 700, rows: [["Session chiffrée, une par compte"], ["Supprimable en un clic"], ["Avec ton accord écrit"]] }),
  typo({ dur: 7.4, chip: C, caps: [[0.2, 3.4, "Au *rythme humain,*"], [3.6, 7.3, "et à la moindre alerte,\n*le compte se met en pause.*", { fs: 74 }]],
    t0: 3.9, y: 700, rows: [["Rien n'est retenté"], ["Rien n'est contourné"], ["Journal des actions gardé 90 jours"]] }),
  typo({ dur: 5.6, chip: C, caps: [[0.2, 5.5, "Inclus avec Agence,\n*en option* avec Starter et Pro.", { fs: 70 }]],
    t0: 0.9, y: 700, rows: [["Jusqu'à 10 comptes Vinted"], ["Pause en un clic"]] }),
  { dur: 4.4, html: endCard("Vends même\n*ordinateur éteint.*", 7) },
]); } });

reg("55-film-comptes", { formats: V, build: () => { const C = "Selio Comptes"; return seq([
  titleCard("Comptes", "Ouvrir sa boutique Vinted,\n*étape par étape.*"),
  typo({ dur: 7, chip: C, caps: [[0.3, 3.2, "Tu lances une\n*nouvelle boutique ?*"], [3.4, 6.9, "Une checklist à suivre,\n*toi-même, dans Vinted.*", { fs: 78 }]],
    t0: 3.8, y: 700, rows: [["De l'inscription"], ["À la préparation du compte"], ["Jusqu'aux premières annonces"]] }),
  typo({ dur: 7.4, chip: C, caps: [[0.2, 3.4, "Et des textes\n*prêts à copier,*"], [3.6, 7.3, "rédigés à partir\n*de tes réponses.*"]],
    t0: 0.9, y: 700, rows: [["Ta présentation"], ["Tes règles d'envoi"], ["Tes réponses types"]] }),
  typo({ dur: 5.6, chip: C, caps: [[0.2, 5.5, "Selio ne crée *aucun compte*\nà ta place.", { fs: 76 }]],
    t0: 0.9, y: 700, rows: [["C'est toi qui ouvres"], ["C'est toi qui décides"]] }),
  { dur: 4.4, html: endCard("Ta boutique,\n*bien préparée.*", 6) },
]); } });

reg("56-film-agents", { formats: V, build: () => { const C = "Selio Agents · aperçu"; return seq([
  titleCard("Agents", "Administrateur,\n*équipes et accès.*"),
  typo({ dur: 7, chip: C, caps: [[0.3, 3.2, "Vous êtes plusieurs sur\n*les mêmes comptes ?*", { fs: 78 }], [3.4, 6.9, "Chacun son rôle,\n*chacun ses accès.*"]],
    t0: 3.8, y: 700, rows: [["Un administrateur"], ["Des membres d'équipe"], ["Des rôles clairs"]] }),
  typo({ dur: 6.6, chip: C, caps: [[0.2, 3.0, "Qui a fait quoi ?"], [3.2, 6.5, "Le *journal d'audit*\nle dit."]],
    t0: 3.6, y: 700, rows: [["Chaque accès est réglé par rôle"], ["Chaque action est tracée"]] }),
  typo({ dur: 5.6, chip: C, caps: [[0.2, 5.5, "Agences et dépôts-vente :\n*vos boutiques clientes.*", { fs: 74 }]],
    t0: 0.9, y: 700, rows: [["Suivies au même endroit"], ["Marque blanche, en aperçu"]] }),
  { dur: 4.4, html: endCard("Travaille\n*à plusieurs.*", 4) },
]); } });

reg("57-film-plateforme", { formats: V, build: () => { const C = "La plateforme"; return seq([
  titleCard("Plateforme", "Une plateforme,\n*puis des filiales.*"),
  { dur: 8, html: `${chip(C)}${caps([[0.3, 3.4, "D'abord, l'outil\n*de gestion.*"], [3.6, 7.9, "Ensuite, des filiales\n*spécialisées :*"]])}
      ${plan(3.9, 580, "Studio", "Écrire les annonces", "à partir de tes photos")}${plan(4.5, 880, "Radar", "Repérer les affaires", "notées sur 100", true)}${plan(5.1, 1180, "Track", "Savoir où sourcer", "les statistiques du marché")}` },
  { dur: 7, html: `${chip(C)}${caps([[0.2, 6.9, "Sur la même IA,\n*les mêmes données.*"]])}
      ${plan(0.8, 580, "Cloud", "Vendre ordinateur éteint", "en aperçu")}${plan(1.4, 880, "Agents", "Travailler en équipe", "en aperçu")}${plan(2.0, 1180, "Comptes", "Ouvrir une nouvelle boutique", "étape par étape")}` },
  typo({ dur: 5.4, chip: C, caps: [[0.2, 5.3, "*Un seul compte*\npour tout Selio."]], t0: 0.9, y: 700, rows: [["Sans rien ressaisir"], ["De l'achat à la marge"]] }),
  { dur: 4.4, html: endCard(undefined, 0) },
]); } });
