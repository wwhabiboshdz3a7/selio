/* Un module par vidéo (1080 × 1920) : vrais écrans de la démo dans l'iPhone, sous-titres repris des spots validés. */
const V = ["9x16"];
const demo = (o) => ({ dur: o.dur, keep: o.keep, html: `${chip(o.chip)}${caps(o.caps)}${phone(o.page, o)}${o.extra || ""}` });
const END = (lines, th = 0) => ({ dur: 4.4, html: endCard(lines, th) });
const APPLI = "Une appli.\nTout ton\n*business Vinted.*";

reg("03-track", { formats: V, build: () => seq([
  demo({ dur: 10.4, chip: "Selio Track", page: "track", scroll: [[7.6, 250, 1.2]],
    caps: [[0.3, 3.5, "Revente moyenne\n*13 à 14 €* :"], [3.7, 7.4, "Track te fixe\n*5 € d'achat maximum.*"], [7.6, 10.3, "Tu sais quoi payer,\n*avant d'acheter.*"]],
    ov: hl(1.3, 20, 366, 560, 392, 3.6) + hl(4.3, 298, 772, 282, 162),
    extra: fchip(4.7, 7.4, 770, 1620, "Achat max conseillé", "5,00 €", "shield", true) + fchip(8.2, 10.2, 310, 1700, "Comparables", "48 ventes observées", "chart") }),
  END(undefined, 1),
]) });

reg("04-radar", { formats: V, build: () => seq([
  demo({ dur: 5.4, keep: true, chip: "Selio Radar", page: "radar", scroll: [[2.7, 330, 1.2]],
    caps: [[0.3, 2.6, "Le *Radar* surveille\ntes recherches Vinted."], [2.8, 5.3, "Chaque annonce est\nnotée *sur 100.*"]],
    ov: hl(3.7, 20, 1006, 560, 112),
    extra: fchip(4.0, 5.3, 770, 1700, "Alerte à partir de", "80 / 100", "bell") }),
  demo({ dur: 3.4, keep: true, chip: "Selio Radar", page: "radar", enter: false, scroll: [[-20, 330, 0.01]],
    caps: [[0.2, 3.3, "*82* : ton\ntéléphone sonne."]],
    extra: notif(0.25, 3.2, 600, "Affaire Radar : Pull Tommy Hilfiger femme à pois", "4,00 € · note 82 · revente estimée 13,50 €") }),
  demo({ dur: 6, chip: "Selio Radar", page: "deal", enter: false, scroll: [[1.7, 480, 1.3]],
    caps: [[0.2, 2.5, "Tu ouvres l'annonce,"], [2.7, 5.9, "avec le\n*vrai bénéfice.*"]],
    ov: hl(3.2, 20, 1268, 560, 156),
    extra: fchip(3.6, 5.8, 770, 1680, "Bénéfice estimé", "+5,70 €", "coin", true) }),
  END(APPLI, 1),
]) });

reg("05-controle", { formats: V, build: () => seq([
  demo({ dur: 9.6, chip: "Contrôle à la réception", page: "check", scroll: [[3.3, 230, 1.1]],
    caps: [[0.3, 3.2, "Tu vérifies toi-même\n*étiquette et coutures,*"], [3.4, 6.4, "guidé par les indices\nd'authenticité,"], [6.6, 9.5, "puis *tu valides.*"]],
    ov: hl(1.2, 20, 360, 560, 304, 3.3) + ck(4.2, 67, 805) + ck(4.9, 67, 926) + ck(5.6, 67, 1050) + hl(7.5, 22, 1216, 556, 72) + tapS(7.4, 300, 1251),
    extra: fchip(7.9, 9.4, 540, 1720, "Achat validé", "4,00 €", "check", true) }),
  END(undefined, 2),
]) });

const TITRE = "Pull Tommy Hilfiger femme col rond à pois · Bleu marine · M";
const DESC = "Pull Tommy Hilfiger pour femme, bleu marine à pois blancs, col rond, maille fine en coton. Très bon état, porté deux fois, aucun défaut. Taille M, coupe droite, mesures sur les photos.";
reg("06-studio", { formats: V, build: () => seq([
  demo({ dur: 4.8, keep: true, chip: "Selio Studio", page: "studio", scroll: [[0.9, 560, 1.3]],
    caps: [[0.3, 2.3, "Tu déposes tes photos\n*d'un coup.*"], [2.5, 4.7, "L'IA reconnaît\n*l'article.*"]],
    ov: hl(2.5, 66, 862, 470, 262),
    extra: fchip(2.9, 4.6, 770, 1690, "Photos lues", "6 sur 6", "cam") }),
  demo({ dur: 7, keep: true, chip: "Selio Studio", page: "studiolisting", enter: false, scroll: [[4.7, 330, 1.2]],
    caps: [[0.2, 2.7, "*Titre complet,*\ndescription optimisée :"], [2.9, 4.7, "l'annonce *s'écrit,*"], [4.9, 6.9, "avec le\n*prix conseillé.*"]],
    ov: `<div class="ov tf" style="left:24px;top:467px;width:551px;height:89px">${type(TITRE, 0.5, 34)}</div><div class="ov tf small" style="left:24px;top:616px;width:551px;height:178px">${type(DESC, 2.3, 80)}</div>` + hl(5.6, 20, 1243, 560, 78),
    extra: fchip(5.9, 6.9, 770, 1720, "Prix conseillé", "14,00 €", "tag", true) }),
  demo({ dur: 3.8, chip: "Selio Studio", page: "studiolisting", enter: false, scroll: [[-20, 330, 0.01]],
    caps: [[0.2, 3.7, "Tu relis.\n*Tu publies.*"]],
    ov: `<div class="ov tf" style="left:24px;top:467px;width:551px;height:89px">${TITRE}</div><div class="ov tf small" style="left:24px;top:616px;width:551px;height:178px">${DESC}</div>` + hl(1.1, 306, 1334, 274, 76) + tapS(1.0, 442, 1371),
    extra: fchip(1.6, 3.7, 540, 1730, "Annonce", "en ligne sur ton compte", "check", true) }),
  END(APPLI, 2),
]) });

reg("07-dressing", { formats: V, build: () => seq([
  demo({ dur: 9.8, chip: "Dressing", page: "vdressing", hd: 208, scroll: [[6.3, 430, 1.3]],
    caps: [[0.3, 3.0, "Ton dressing,\ntel que tu le connais,"], [3.2, 6.2, "avec une *note sur 100*\npar annonce."], [6.4, 9.7, "Tu sais quoi republier,\n*et quand.*"]],
    ov: bd(3.5, 40, 313, 90, true) + bd(3.75, 326, 313, 72) + bd(4.0, 40, 752, 64) + bd(4.25, 326, 752, 58) + bd(4.5, 40, 1190, 81) + bd(4.75, 326, 1190, 47),
    extra: fchip(5.0, 6.2, 790, 1700, "Note du pull", "90 / 100", "star", true) + fchip(7.2, 9.6, 310, 1710, "À republier", "en ligne depuis 7 j", "clock") }),
  END(undefined, 5),
]) });

reg("08-negociation", { formats: V, build: () => seq([
  demo({ dur: 10.6, chip: "Négociation", page: "nego",
    caps: [[0.3, 2.6, "Une offre\n*trop basse ?*"], [2.8, 6.0, "Selio calcule la bonne\n*contre-offre,*"], [6.2, 8.7, "sans passer sous ton\n*prix plancher.*"], [8.9, 10.5, "*Vendu.*", { slam: true, fs: 130 }]],
    ov: hl(1.0, 18, 438, 474, 142, 2.8)
      + `<div class="ov msgbox"${an(3.5, "up", 0.45, "left:24px;top:612px;width:552px")}><div class="msg">Bonjour Léa, merci pour ton offre ! Je peux te le laisser à 12,50 €, envoi dès demain.<span class="t">Négociation automatique · 20:04</span></div></div>${sfx("swish", 3.5)}`
      + `<div class="ov msgbox"${an(7.5, "up", 0.45, "left:24px;top:780px;width:552px;justify-content:flex-start")}><div class="msg" style="background:#2D2A35;border-radius:18px;border-bottom-left-radius:5px">D'accord, je le prends !<span class="t">20:06</span></div></div>${sfx("notif", 7.5, 1)}`
      + `<div class="ov sold"${an(8.9, "pop", 0.45, "left:24px;top:900px;width:552px;height:66px;--ez:var(--back)")}><span class="ok">${CK}</span>Vendu · 12,50 €</div>${sfx("kaching", 8.9)}${sfx("impact", 8.9, 1)}`,
    extra: fchip(4.2, 6.0, 760, 1680, "Contre-offre calculée", "12,50 €", "spark") + fchip(6.6, 8.7, 320, 1690, "Prix plancher", "11,50 € respecté", "shield", true) }),
  END(APPLI, 3),
]) });

reg("09-automatisation", { formats: V, build: () => seq([
  demo({ dur: 10, chip: "Automatisation", page: "autohub", scroll: [[1.0, 430, 1.4], [5.0, 560, 1.6]],
    caps: [[0.3, 3.3, "Favoris, réponses,\naprès-vente…"], [3.5, 6.4, "*tout s'automatise.*"], [6.6, 9.9, "Tu actives\n*ce que tu veux.*"]],
    ov: hl(2.2, 448, 631, 104, 42) + hl(2.6, 448, 949, 104, 42) + hl(3.0, 448, 1267, 104, 42) + hl(6.4, 448, 1585, 104, 42),
    extra: fchip(2.0, 3.3, 310, 1710, "Favoris", "petite remise envoyée", "heart") + fchip(3.7, 4.9, 780, 1710, "Réponse auto", "questions courantes", "msg")
      + fchip(5.3, 6.4, 310, 1710, "Négociation", "selon tes règles de prix", "tag") + fchip(6.9, 9.8, 770, 1710, "Après-vente", "relance après 24 h", "clock", true) }),
  END(undefined, 4),
]) });

reg("10-commandes", { formats: V, build: () => seq([
  demo({ dur: 9, chip: "Gestion", page: "orders", scroll: [[0.9, 330, 1.3], [4.4, 360, 1.4]],
    caps: [[0.3, 3.0, "*Bordereaux d'envoi*\ngénérés,"], [3.2, 6.0, "puis l'export pour\nton comptable :"], [6.2, 8.9, "*ventes et marges.*"]],
    ov: hl(2.0, 20, 668, 560, 70, 3.4) + hl(2.25, 20, 741, 560, 70, 3.4) + hl(2.5, 20, 814, 560, 70, 3.4),
    extra: fchip(2.6, 4.3, 770, 1690, "Après-vente", "3 bordereaux générés", "box", true) + fchip(6.5, 8.8, 540, 1710, "Export", "ventes et marges · CSV", "chart", true) }),
  END(APPLI, 0),
]) });

reg("11-analyses", { formats: V, build: () => seq([
  demo({ dur: 9.2, chip: "Analyses", page: "analytics", scroll: [[4.3, 430, 1.4]],
    caps: [[0.3, 3.2, "Tu vois enfin tes\n*vraies marges.*"], [3.4, 5.9, "*Au centime près.*", { slam: true, fs: 104 }], [6.1, 9.1, "Chiffre d'affaires, marge,\n*rotation du stock.*", { fs: 76 }]],
    ov: hl(1.2, 22, 700, 278, 190) + hl(1.6, 300, 700, 276, 190),
    extra: fchip(2.0, 3.3, 780, 1640, "Marge brute", "117,86 €", "coin", true) + fchip(6.8, 9.0, 310, 1710, "Rotation du stock", "40 j", "clock") }),
  END(undefined, 5),
]) });

const priceB = (t0, t1, label, inner, color = "#fff") => `<div class="price" style="top:1420px"><div${an(t1 - 0.2, "out", 0.2)}><div${an(t0, "slam", 0.4)}><small>${label}</small><b style="color:${color}">${inner}</b></div></div></div>${sfx("slam", t0, 1)}`;
reg("14-pepite", { formats: V, build: () => seq([
  { dur: 10.8, html: `${chip("Selio Radar")}${caps([[0.3, 2.7, "Ce pull, repéré à\n*4,00 €*…"], [2.9, 5.3, "revente estimée :\n*13,50 €.*"], [5.5, 8.0, "*+5,70 €* de bénéfice,\nfrais compris."], [8.2, 10.7, "Et tu ne l'as même\n*pas cherché.*"]])}
      <div${an(0.1, "phoneIn", 1, "position:absolute;inset:0;perspective:2400px")}><div class="pcard loop" style="top:520px;--an:floatP;--du:5s"><img src="img/pull.jpg"><div class="tx"><b>Pull Tommy Hilfiger femme à pois</b><small>Taille M · Très bon état</small></div></div></div>${sfx("whoosh", 0.1)}
      ${priceB(0.8, 2.8, "Prix", "4,00 €")}${priceB(2.9, 5.4, "Revente estimée", count(13.5, 3.0, 0.9, "eur", 4))}${priceB(5.5, 10.9, "Bénéfice", count(5.7, 5.6, 0.9, "peur"), "#E2C67C")}${sfx("kaching", 5.6)}
      ${fchip(8.5, 10.7, 800, 610, "Note Radar", "82 / 100", "star")}` },
  END(APPLI, 1),
]) });

reg("13-ecosysteme", { formats: V, build: () => {
  const W = [["Trouve.", "radar"], ["Publie.", "studioann"], ["Négocie.", "nego"], ["Encaisse.", "analytics"]];
  return seq([
    { dur: 6.6, html: W.map(([w, th], i) => `${caps([[0.3 + i * 1.55, 0.3 + (i + 1) * 1.55 - 0.05, i === 3 ? `*${w}*` : w, { slam: true, fs: 170, top: 270 }]])}
        <div style="position:absolute;inset:0;perspective:1800px"><div${an(0.3 + (i + 1) * 1.55 - 0.25, "out", 0.2, "position:absolute;left:260px;top:600px")}><div${an(0.3 + i * 1.55, "phoneIn", 0.6)}><div class="cc" style="position:relative;width:560px;height:1212px;border-radius:72px;border-width:5px;transform:rotateY(${i % 2 ? 9 : -9}deg) rotateX(4deg)"><img src="${ECR}thumb-${th}.jpg"></div></div></div></div>`).join("") },
    END(APPLI, 3),
  ]);
} });
