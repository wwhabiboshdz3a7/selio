/* Commercialisation : essai, offres, parcours complet, objections. Faits repris de la page Tarifs (packages/demo-data/src/plans.ts). */
const heroB = (t0, t1, y, inner, fs = 420) => `<div class="hero" style="top:${y}px;--fs:${fs}px"><div${an(t1 - 0.2, "out", 0.2)}><div${an(t0, "slam", 0.45)}>${inner}</div></div></div>${sfx("slam", t0, 1)}`;

reg("15-essai-14-jours", { formats: V, build: () => seq([
  { dur: 8.6, html: `${chip("Essai")}${caps([[0.3, 2.9, "Essaie Selio sur\n*ta propre activité.*"], [3.1, 8.5, "*14 jours* gratuits."]])}
      ${heroB(0.5, 8.7, 500, count(14, 0.6, 1.4, "int"), 480)}<div class="kick"${an(1.0, "fade", 0.5, "top:990px")}>jours d'essai</div>
      ${crow(3.6, 1150, "Toutes les fonctions du plan Pro")}${crow(4.4, 1310, "Rien n'est débité avant la fin")}${crow(5.2, 1470, "Résiliable à tout moment")}` },
  END(undefined, 0),
]) });

reg("16-trois-offres", { formats: V, build: () => seq([
  { dur: 10, html: `${chip("Tarifs")}${caps([[0.3, 3.2, "Après l'essai, l'offre\n*qui te ressemble.*"], [3.4, 6.5, "Au mois,\n*sans engagement.*"], [6.7, 9.9, "Ou à l'année :\n*2 mois offerts.*"]])}
      ${plan(0.9, 560, "Starter", "Le revendeur qui démarre", "1 compte Vinted · stock, dressing, messagerie, commandes et marges")}
      ${plan(1.5, 920, "Pro", "Le revendeur régulier", "3 comptes Vinted · Track essentiel · annonces Studio", true)}
      ${plan(2.1, 1240, "Agence", "L'équipe et les comptes multiples", "10 comptes Vinted · Track complet · Cloud inclus · rôles d'équipe")}` },
  END(undefined, 2),
]) });

reg("17-offre-fondateurs", { formats: V, build: () => seq([
  { dur: 9.6, html: `${chip("Offre fondateurs")}${caps([[0.3, 3.0, "Pour les *50 premiers*\nclients :"], [3.2, 6.3, "*−30 %* pendant 6 mois\nsur Pro et Agence,"], [6.5, 9.5, "*1 mois offert*\nsur Starter."]])}
      ${heroB(0.6, 3.1, 720, count(50, 0.7, 1.2, "int"), 520)}${heroB(3.2, 6.4, 740, "−30 %", 300)}${heroB(6.5, 9.7, 760, "1 mois", 270)}
      <div class="kick"${an(0.9, "fade", 0.5, "top:1290px")}><div${an(3.0, "out", 0.2)}>premiers clients</div></div>
      <div class="kick"${an(3.5, "fade", 0.5, "top:1110px")}><div${an(6.2, "out", 0.2)}>pendant 6 mois · Pro et Agence</div></div>
      <div class="kick"${an(6.8, "fade", 0.5, "top:1100px")}>offert · Starter</div>` },
  END(undefined, 4),
]) });

reg("18-parcours-complet", { formats: V, build: () => {
  const STEPS = [["Sourcer", "track", 0], ["Repérer", "deal", 0], ["Contrôler", "check", 0], ["Rédiger", "studiolisting", 0], ["Publier", "vpublished", 0], ["Négocier", "nego", 0], ["Expédier", "orders", 200], ["Compter", "analytics", 0]];
  return seq([
    { dur: 2.8, html: `<div class="cap slam" style="--top:760px;--fs:104px"><div${an(0.2, "up", 0.5)}>${capWords("De l'achat\nà la marge,\n*sans rien ressaisir.*", 0.3, 0.14)}</div></div>` },
    ...STEPS.map(([w, pg, sc], i) => ({ dur: 1.3, keep: i < 7, html: `<div class="chip" style="transform-origin:100% 50%"><i></i>${i + 1} / 8</div>${caps([[0.05, 1.25, i === 7 ? `*${w}.*` : `${w}.`, { slam: true, fs: 150, top: 240 }]])}${phone(pg, { enter: i === 0, top: 470, hd: pg[0] === "v" ? 208 : 168, scroll: sc ? [[0.2, sc, 0.9]] : [] })}` })),
    END(APPLI, 6),
  ]);
} });

reg("19-avant-apres", { formats: V, build: () => seq([
  { dur: 5.2, html: `${caps([[0.2, 5.15, "Avant.", { slam: true, fs: 170, top: 300 }]])}
      ${crow(0.8, 640, "Neuf applis ouvertes", true)}${crow(1.5, 800, "Un tableur pour le stock", true)}${crow(2.2, 960, "La calculette pour les marges", true)}${crow(2.9, 1120, "Des copier-coller pour les annonces", true)}${crow(3.6, 1280, "Les offres négociées une par une", true)}` },
  { dur: 5.4, html: `${caps([[0.15, 5.35, "*Après.*", { slam: true, fs: 170, top: 300 }]])}
      ${crow(0.8, 640, "Une seule appli")}${crow(1.5, 800, "Stock, ventes et marges au même endroit")}${crow(2.2, 960, "Marges calculées au centime près")}${crow(2.9, 1120, "Annonces rédigées par l'IA")}${crow(3.6, 1280, "Négociation selon tes règles de prix")}` },
  END(APPLI, 5),
]) });

const hour = (h, line) => caps([[0.1, 99, h, { slam: true, fs: 160, top: 210 }]]).replace('data-a style="--d:98.8s', 'data-a style="--d:999s') + caps([[0.5, 99, line, { fs: 60, top: 400 }]]).replace('data-a style="--d:98.8s', 'data-a style="--d:999s');
const sceneOutCap = (html, dur) => `<div${an(dur - 0.25, "out", 0.2, "position:absolute;left:0;right:0;top:0;height:520px")}>${html}</div>`;
reg("20-une-journee", { formats: V, build: () => seq([
  { dur: 3.8, keep: true, html: `${chip("Selio Radar")}${sceneOutCap(hour("9:41", "Le Radar a repéré *une affaire.*"), 3.8)}${phone("radar", { top: 540, scroll: [[-20, 330, 0.01]] })}${notif(0.9, 3.7, 640, "Affaire Radar : Pull Tommy Hilfiger femme à pois", "4,00 € · note 82 · revente estimée 13,50 €")}` },
  { dur: 3.8, keep: true, html: `${chip("Selio Studio")}${sceneOutCap(hour("12:30", "L'annonce *s'écrit toute seule.*"), 3.8)}${phone("studiolisting", { top: 540, enter: false, ov: `<div class="ov tf" style="left:24px;top:467px;width:551px;height:89px">${type(TITRE, 0.5, 34)}</div><div class="ov tf small" style="left:24px;top:616px;width:551px;height:178px">${type(DESC, 1.6, 110)}</div>` })}` },
  { dur: 3.8, keep: true, html: `${chip("Négociation")}${sceneOutCap(hour("20:04", "Une offre ? Selio *contre-propose.*"), 3.8)}${phone("nego", { top: 540, enter: false, ov: `<div class="ov msgbox"${an(1.2, "up", 0.45, "left:24px;top:612px;width:552px")}><div class="msg">Bonjour Léa, merci pour ton offre ! Je peux te le laisser à 12,50 €, envoi dès demain.<span class="t">Négociation automatique · 20:04</span></div></div>${sfx("swish", 1.2)}` })}` },
  { dur: 3.4, keep: true, html: `${chip("Ventes")}${sceneOutCap(hour("20:06", "*Vendu,* au-dessus du plancher."), 3.4)}${phone("nego", { top: 540, enter: false, ov: `<div class="ov msgbox" style="left:24px;top:612px;width:552px"><div class="msg">Bonjour Léa, merci pour ton offre ! Je peux te le laisser à 12,50 €, envoi dès demain.<span class="t">Négociation automatique · 20:04</span></div></div><div class="ov msgbox"${an(0.4, "up", 0.45, "left:24px;top:780px;width:552px;justify-content:flex-start")}><div class="msg" style="background:#2D2A35;border-bottom-right-radius:18px;border-bottom-left-radius:5px">D'accord, je le prends !<span class="t">20:06</span></div></div><div class="ov sold"${an(1.2, "pop", 0.45, "left:24px;top:900px;width:552px;height:66px;--ez:var(--back)")}><span class="ok">${CK}</span>Vendu · 12,50 €</div>${sfx("kaching", 1.2)}` })}` },
  { dur: 3.8, html: `${chip("Analyses")}${sceneOutCap(hour("Fin du mois", "Tes marges, *au centime près.*").replace("--fs:160px", "--fs:120px"), 3.8)}${phone("analytics", { top: 540, enter: false, ov: hl(1.0, 22, 700, 278, 190) + hl(1.3, 300, 700, 276, 190) })}` },
  END(APPLI, 4),
]) });

reg("22-republier", { formats: V, build: () => seq([
  demo({ dur: 9.8, chip: "Dressing intelligent", page: "vdressing", hd: 208, scroll: [[1.6, 430, 1.3]],
    caps: [[0.3, 3.0, "Une annonce qui\n*ne part pas ?*"], [3.2, 6.3, "Dès 7 jours en ligne,\n*republie-la*"], [6.5, 9.7, "avec l'une des *10 variantes*\ndéjà prêtes.", { fs: 76 }]],
    ov: bd(3.0, 40, 752, 64) + bd(3.2, 326, 752, 58) + bd(3.4, 40, 1190, 81) + bd(3.6, 326, 1190, 47) + hl(3.9, 306, 1166, 274, 366),
    extra: fchip(4.2, 6.3, 300, 1720, "En ligne depuis", "7 jours", "clock") + fchip(6.9, 9.7, 770, 1720, "Variantes prêtes", "10", "spark", true) }),
  END(undefined, 6),
]) });

reg("23-prix-conseille", { formats: V, build: () => seq([
  { dur: 10, html: `${chip("Prix conseillé")}${caps([[0.3, 3.2, "Un prix,\n*trois stratégies.*"], [3.4, 6.5, "Calculées sur des\n*ventes comparables.*"], [6.7, 9.9, "Jamais sous ton\n*prix plancher.*"]])}
      ${plan(0.9, 580, "Vente rapide", "Vendre vite", "quitte à laisser un peu de marge")}
      ${plan(1.5, 900, "Standard", "Le prix du milieu", "celui des ventes comparables", true)}
      ${plan(2.1, 1220, "Marge maximale", "Attendre le bon acheteur", "celui qui paiera plus")}` },
  END(APPLI, 2),
]) });

reg("25-demo-sans-compte", { formats: V, build: () => seq([
  demo({ dur: 7.4, chip: "Démo", page: "analytics", scroll: [[2.4, 430, 2.2]],
    caps: [[0.3, 3.0, "Pas encore décidé ?"], [3.2, 7.3, "Explore la démo,\n*sans compte.*"]],
    extra: fchip(3.8, 7.3, 540, 1730, "Démo", "ouverte, sans inscription", "check", true) }),
  { dur: 4.4, html: endCard(undefined, 3, "Explore la démo") },
]) });

reg("26-toi-qui-decides", { formats: V, build: () => seq([
  demo({ dur: 10.4, chip: "Selio Studio", page: "studiolisting", scroll: [[2.2, 330, 1.2]],
    caps: [[0.3, 3.0, "Selio publie à ta place ?\n*Non.*", { fs: 80 }], [3.2, 6.4, "Rien n'est publié\n*sans ton clic.*"], [6.6, 10.3, "Le Radar t'alerte.\n*C'est toi qui achètes.*", { fs: 80 }]],
    ov: `<div class="ov tf" style="left:24px;top:467px;width:551px;height:89px">${TITRE}</div><div class="ov tf small" style="left:24px;top:616px;width:551px;height:178px">${DESC}</div>` + hl(3.8, 14, 1416, 330, 38) + hl(4.2, 306, 1334, 274, 76),
    extra: fchip(7.0, 10.2, 540, 1730, "Radar", "lit, note et t'alerte", "bell") }),
  END(undefined, 1),
]) });
