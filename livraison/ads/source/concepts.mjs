// Les quatre concepts : textes affichés sur les visuels et scènes (compositions de captures réelles et de cartes
// dessinées dans le style de l'application). Les chiffres affichés sont des données d'exemple, marquées comme telles.
import { ASSET, C, crop, ring, ICON } from "./commun.mjs";
import { jeanPhoto } from "./jean.mjs";

const W_MOBILE = 1179; // largeur des captures mobiles (livraison/video/source/ecrans)

const ex = (t = "Données d'exemple", style = "") => `<span class="ex" style="${style}">${t}</span>`;

/* ----------------------------------------------------------------------------------------------
 * A — Selio Manager : toute l'activité au même endroit, multi-comptes
 * -------------------------------------------------------------------------------------------- */
function comptesCard(width = 460) {
  const rows = [
    ["BP", "Boutique principale", "32 articles en vente", "#7C5CEB"],
    ["BV", "Boutique vintage", "18 articles en vente", "#C1933B"],
    ["CA", "Compte achats", "Achats et suivis", "#5B8DEF"],
  ];
  return `<div class="card" style="width:${width}px;padding:24px 26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <b style="font-size:24px;font-weight:600">Mes comptes</b>
      <span style="font-size:16px;color:${C.v300};background:rgba(124,92,235,.18);padding:6px 12px;border-radius:99px;font-weight:600">3 connectés</span></div>
    ${rows.map(([ini, name, sub, col]) => `<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-top:1px solid ${C.border}">
      <span style="width:46px;height:46px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;flex:none">${ini}</span>
      <span style="flex:1;line-height:1.25"><b style="font-size:20px;font-weight:600;display:block">${name}</b><small style="font-size:16px;color:${C.muted}">${sub}</small></span>
      <span style="font-size:15px;color:${C.success};display:flex;align-items:center;gap:6px"><i style="width:8px;height:8px;border-radius:50%;background:${C.success};display:inline-block"></i>Connecté</span></div>`).join("")}
    <div style="border-top:1px solid ${C.border};padding-top:14px;font-size:17px;color:${C.muted}">Stock, messages, commandes et marges réunis.</div></div>`;
}

const nego = (y0, width) => crop(ASSET.ecran("nego"), W_MOBILE, { x: 20, y: y0, w: 1139, h: 2490 - y0 }, width);
const ca = (width) => crop(ASSET.ecran("overview"), W_MOBILE, { x: 20, y: 2075, w: 1139, h: 530 }, width);
const orders = (h, width) => crop(ASSET.ecran("orders"), W_MOBILE, { x: 20, y: 1225, w: 1139, h }, width);

const manager = {
  key: "A",
  slug: "manager",
  produit: "Selio Manager",
  title: "Toute ton activité Vinted <em>au&nbsp;même&nbsp;endroit.</em>",
  titleShort: "Toute ton activité Vinted <em>au même endroit.</em>",
  titleBanner: "Toute ton activité Vinted <em>au même endroit</em>",
  titleTiny: "Tous tes comptes Vinted, <em>un seul tableau</em>",
  sub: "Stock, messages, offres, commandes et marges, sur tous tes comptes. Tu fixes les règles, tu gardes la main.",
  subShort: "Stock, messages, offres, commandes et marges, sur tous tes comptes.",
  scene(kind) {
    if (kind === "focus") {
      return `<div class="scene" style="width:700px;height:600px">
        <div style="position:absolute;left:0;top:0;z-index:2">${comptesCard(430)}</div>
        <div style="position:absolute;right:0;top:40px;z-index:3">${nego(1350, 255)}</div>
        <div style="position:absolute;left:0;top:372px;z-index:4">${ca(430)}</div>
        <div style="position:absolute;right:0;top:470px;z-index:5">${ex()}</div></div>`;
    }
    if (kind === "tall") {
      return `<div class="scene" style="width:900px;height:960px">
        <div style="position:absolute;left:0;top:0;z-index:2">${comptesCard(450)}</div>
        <div style="position:absolute;right:0;top:40px;z-index:3">${nego(940, 450)}</div>
        <div style="position:absolute;left:0;top:400px;z-index:2">${ca(420)}</div>
        <div style="position:absolute;left:0;top:660px;z-index:4">${orders(330, 900)}</div>
        <div style="position:absolute;right:0;top:922px;z-index:5">${ex()}</div></div>`;
    }
    return `<div class="scene" style="width:1060px;height:720px">
      <div style="position:absolute;left:0;top:20px;z-index:2">${comptesCard(450)}</div>
      <div style="position:absolute;left:0;top:405px;z-index:2">${ca(450)}</div>
      <div style="position:absolute;right:0;top:0;z-index:3">${nego(1350, 560)}</div>
      <div style="position:absolute;right:0;top:585px;z-index:4">${orders(280, 560)}</div>
      <div style="position:absolute;left:0;top:640px;z-index:5">${ex()}</div></div>`;
  },
  mini(kind) {
    if (kind === "sky") return `<div class="scene" style="width:300px">${comptesCard(300).replace(/font-size:2[04]px/g, "font-size:18px")}</div>`;
    return `<div class="scene" style="display:flex;flex-direction:column;gap:6px;width:150px">${[["BP", "#7C5CEB"], ["BV", "#C1933B"], ["CA", "#5B8DEF"]].map(([i, c]) => `<div style="display:flex;align-items:center;gap:8px;background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:6px 8px"><span style="width:26px;height:26px;border-radius:50%;background:${c};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">${i}</span><span style="font-size:12px;color:${C.success}">● Connecté</span></div>`).join("")}</div>`;
  },
};

/* ----------------------------------------------------------------------------------------------
 * B — Selio Studio : tes photos deviennent une annonce (exemple du jean)
 * -------------------------------------------------------------------------------------------- */
const STUDIO_TITLE = "Jean Levi's 501 Original droit bleu W32 L32 — 100 % coton";

function photo(view, w, h, tag) {
  return `<div style="position:relative;width:${w}px;height:${h}px;border-radius:14px;overflow:hidden;box-shadow:0 18px 44px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);flex:none">${jeanPhoto(view)}${tag ? `<span style="position:absolute;left:10px;bottom:10px;font-size:14px;font-weight:600;padding:5px 10px;border-radius:99px;background:rgba(18,16,23,.82);color:${C.text}">${tag}</span>` : ""}</div>`;
}

function field(label, value, src) {
  return `<div style="padding:12px 14px;border:1px solid ${C.border};border-radius:12px;background:rgba(255,255,255,.02)">
    <small style="display:block;font-size:14px;color:${C.muted};margin-bottom:3px">${label}</small>
    <b style="display:block;font-size:20px;font-weight:600">${value}</b>
    <small style="display:flex;align-items:center;gap:5px;font-size:13px;color:${C.success};margin-top:4px">${ICON.check(14)}${src}</small></div>`;
}

function listingCard(width = 600) {
  return `<div class="card" style="width:${width}px;padding:26px 28px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span style="display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600">${ICON.spark(24)}Annonce rédigée</span>${ex("Exemple")}</div>
    <small style="font-size:14px;color:${C.muted};text-transform:uppercase;letter-spacing:.06em">Titre</small>
    <div style="font-size:27px;font-weight:600;line-height:1.25;margin:4px 0 18px;letter-spacing:-.01em">${STUDIO_TITLE}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px">
      ${field("Marque", "Levi's", "lue sur l'étiquette")}${field("Taille", "W32 L32", "lue sur l'étiquette")}
      ${field("Matière", "100 % coton", "lue sur l'étiquette")}${field("Tour de taille", "41 cm", "mesuré au ruban")}</div>
    <small style="font-size:14px;color:${C.muted};text-transform:uppercase;letter-spacing:.06em">Description</small>
    <div style="position:relative;font-size:17px;line-height:1.45;color:#D9D4E2;margin-top:4px;height:100px;overflow:hidden;-webkit-mask:linear-gradient(#000 55%,transparent)">
      Jean Levi's 501 Original en coupe droite, coloris bleu, taille W32 L32 : le grand classique du denim, facile à porter au quotidien. Matière et entretien : 100 % coton (étiquette de composition), sans élasthanne…</div>
    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${C.border};padding-top:16px;margin-top:6px">
      <span><small style="display:block;font-size:14px;color:${C.muted}">Prix conseillé</small><b style="font-size:30px;font-weight:700">32 €</b></span>
      <span style="display:flex;gap:10px"><span style="padding:12px 18px;border-radius:12px;border:1px solid ${C.border};font-size:17px;font-weight:600">Modifier</span>
      <span style="padding:12px 20px;border-radius:12px;background:linear-gradient(90deg,${C.v700},${C.v500});font-size:17px;font-weight:600">Relire et publier</span></span></div></div>`;
}

const arrowBadge = (rot = 0) => `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,${C.v700},${C.v500});display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(100,66,214,.6);transform:rotate(${rot}deg)">${ICON.arrow(30)}</div>`;

const studio = {
  key: "B",
  slug: "studio",
  produit: "Selio Studio",
  title: "Tes photos deviennent <em>une&nbsp;annonce.</em>",
  titleShort: "Tes photos deviennent <em>une annonce.</em>",
  titleBanner: "Tes photos deviennent <em>une annonce</em>",
  titleTiny: "Tes photos deviennent <em>une annonce</em>",
  sub: "Selio Studio lit l'étiquette et rédige le titre, la description et le prix conseillé. Tu relis, tu publies.",
  subShort: "Titre, description et prix conseillé, rédigés à partir de tes photos.",
  scene(kind) {
    if (kind === "focus") {
      return `<div class="scene" style="width:620px">
        <div style="display:flex;gap:12px">${photo("face", 140, 187, "Face")}${photo("etiquette", 140, 187, "Étiquette")}${photo("ruban", 140, 187, "Ruban")}</div>
        <div style="margin-top:14px;position:relative;z-index:2">${listingCard(620)}</div></div>`;
    }
    if (kind === "tall") {
      return `<div class="scene" style="width:900px;height:1080px">
        <div style="display:flex;gap:16px">${photo("face", 213, 284, "Face")}${photo("dos", 213, 284, "Dos")}${photo("etiquette", 213, 284, "Étiquette")}${photo("ruban", 213, 284, "Mètre ruban")}</div>
        <div style="position:absolute;left:418px;top:262px;z-index:3">${arrowBadge(90)}</div>
        <div style="position:absolute;left:0;top:318px;z-index:2">${listingCard(900)}</div></div>`;
    }
    return `<div class="scene" style="width:1080px;height:660px">
      <div style="position:absolute;left:0;top:0">${photo("face", 340, 453, "Photo 1 sur 4")}</div>
      <div style="position:absolute;left:0;top:470px;display:flex;gap:14px">${photo("dos", 104, 139)}${photo("etiquette", 104, 139)}${photo("ruban", 104, 139)}</div>
      <div style="position:absolute;left:378px;top:240px;z-index:3">${arrowBadge()}</div>
      <div style="position:absolute;left:470px;top:0;z-index:2">${listingCard(610)}</div></div>`;
  },
  mini(kind) {
    if (kind === "sky") return `<div class="scene" style="width:300px;display:flex;flex-direction:column;align-items:center;gap:14px">${photo("face", 240, 320)}${arrowBadge(90)}<div class="card" style="padding:14px 16px;font-size:19px;font-weight:600;line-height:1.3">${STUDIO_TITLE}</div></div>`;
    return `<div class="scene" style="display:flex;align-items:center;gap:8px">${photo("face", 90, 120)}${ICON.arrow(22, C.gold)}${photo("etiquette", 90, 120)}</div>`;
  },
};

/* ----------------------------------------------------------------------------------------------
 * C — Selio Bot : les bonnes affaires, notées sur 100
 * -------------------------------------------------------------------------------------------- */
function dealCard(width = 660) {
  const line = (a, b, strong) => `<div style="display:flex;justify-content:space-between;font-size:17px;${strong ? "font-weight:600;color:#fff;border-top:1px dashed #4a4554;padding-top:8px;margin-top:4px" : `color:${C.muted}`}"><span>${a}</span><span style="white-space:nowrap">${b}</span></div>`;
  return `<div class="card" style="width:${width}px;padding:24px">
    <div style="display:flex;gap:20px">
      <div style="position:relative;flex:none"><img src="${ASSET.photo("g-x4iv-1")}" style="width:150px;height:190px;object-fit:cover;border-radius:12px;display:block">
        <div style="position:absolute;left:-14px;top:-14px;background:#1A1820;border-radius:50%;padding:4px">${ring(92, 76, { label: "" })}</div></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><span style="font-size:15px;font-weight:600;color:#E8CF8E;background:rgba(226,198,124,.16);border:1px solid rgba(226,198,124,.4);padding:4px 10px;border-radius:99px">Très bonne affaire</span>${ex("Exemple")}</div>
        <div style="font-size:25px;font-weight:600;line-height:1.2">Pull torsadé gris et blanc</div>
        <div style="font-size:16px;color:${C.muted};margin:4px 0 12px">Taille M · très bon état · repéré 2 min après publication</div>
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px">
          <div style="border:1px solid ${C.border};border-radius:12px;padding:12px 14px"><small style="font-size:13px;color:${C.muted};letter-spacing:.06em">ACHAT</small>${line("Prix", "9,00 €")}${line("Port + protection", "4,05 €")}${line("Total", "13,05 €", true)}</div>
          <div style="border:1px solid ${C.border};border-radius:12px;padding:12px 14px"><small style="font-size:13px;color:${C.muted};letter-spacing:.06em">REVENTE ESTIMÉE</small><div style="font-size:26px;font-weight:700;margin:6px 0 2px">22 – 26 €</div><div style="font-size:14px;color:${C.muted}">8 ventes comparables</div></div></div></div></div>
    <div style="display:flex;align-items:center;gap:14px;margin-top:18px">
      <span style="padding:13px 22px;border-radius:12px;background:linear-gradient(90deg,${C.v700},${C.v500});font-size:18px;font-weight:600">Acheter en 1 clic</span>
      <span style="padding:13px 18px;border-radius:12px;border:1px solid ${C.border};font-size:18px;font-weight:600">Ignorer</span>
      <span style="font-size:15px;color:${C.muted};margin-left:auto;text-align:right;line-height:1.3">Tu valides<br>chaque achat</span></div></div>`;
}

const notif = (width = 600) => `<div style="width:${width}px;display:flex;gap:14px;align-items:center;padding:16px 18px;border-radius:20px;background:rgba(240,236,248,.94);color:#1C1A24;box-shadow:0 18px 50px rgba(0,0,0,.5)">
  <img src="${ASSET.appIcon}" style="width:48px;height:48px;border-radius:12px;flex:none">
  <div style="line-height:1.3;min-width:0"><small style="font-size:14px;color:#6E6A7B;font-weight:500">Selio Bot · maintenant</small>
  <div style="font-size:18px;font-weight:600">Nouvelle affaire notée 92/100</div><div style="font-size:16px;color:#3a3744">Pull torsadé gris et blanc, taille M : 13,05 € port compris</div></div></div>`;

const scale = (width) => crop(ASSET.ecran("radar"), W_MOBILE, { x: 20, y: 1335, w: 1139, h: 1060 }, width);

const bot = {
  key: "C",
  slug: "bot",
  produit: "Selio Bot",
  title: "Trouve les bonnes affaires <em>avant&nbsp;les&nbsp;autres.</em>",
  titleShort: "Trouve les bonnes affaires <em>avant les autres.</em>",
  titleBanner: "Les bonnes affaires, <em>notées sur 100</em>",
  titleTiny: "Les bonnes affaires, <em>notées sur 100</em>",
  sub: "Selio Bot surveille tes recherches, note chaque affaire sur 100 et t'alerte. Tu valides l'achat en 1 clic, dans tes limites.",
  subShort: "Chaque affaire notée sur 100, une alerte, et tu valides en 1 clic.",
  scene(kind) {
    const chips = `<span class="chip">${ICON.bell()}Alerte dès la publication</span><span class="chip">${ICON.shield()}Limite : 40 € par jour</span>`;
    if (kind === "focus") {
      return `<div class="scene" style="width:700px;height:560px">
        <div style="position:absolute;left:40px;top:0;z-index:4">${notif(620)}</div>
        <div style="position:absolute;left:0;top:120px;z-index:2">${dealCard(700)}</div>
        <div style="position:absolute;left:0;top:505px;display:flex;gap:10px;z-index:3">${chips}</div></div>`;
    }
    if (kind === "tall") {
      return `<div class="scene" style="width:880px;height:1000px">
        <div style="position:absolute;left:60px;top:0;z-index:4">${notif(760)}</div>
        <div style="position:absolute;left:0;top:150px;z-index:2">${dealCard(880)}</div>
        <div style="position:absolute;left:0;top:560px;z-index:1">${scale(500)}</div>
        <div style="position:absolute;left:530px;top:600px;display:flex;flex-direction:column;gap:14px;align-items:flex-start;z-index:3">${chips}<span class="chip">${ICON.hand()}Achat rapide validé par toi</span></div></div>`;
    }
    return `<div class="scene" style="width:1060px;height:640px">
      <div style="position:absolute;right:0;top:0;width:380px;z-index:1;opacity:.95">${scale(380)}</div>
      <div style="position:absolute;left:0;top:0;z-index:4">${notif(620)}</div>
      <div style="position:absolute;left:0;top:130px;z-index:2">${dealCard(700)}</div>
      <div style="position:absolute;left:0;top:585px;display:flex;gap:12px;z-index:3">${chips}</div></div>`;
  },
  mini(kind) {
    if (kind === "sky") return `<div class="scene" style="width:300px;display:flex;flex-direction:column;align-items:center;gap:16px"><div style="position:relative"><img src="${ASSET.photo("g-x4iv-1")}" style="width:240px;height:300px;object-fit:cover;border-radius:16px;display:block"><div style="position:absolute;right:-18px;bottom:-18px;background:#1A1820;border-radius:50%;padding:5px">${ring(92, 110, { label: "/100" })}</div></div><span style="font-size:20px;font-weight:600;color:#E8CF8E;background:rgba(226,198,124,.16);border:1px solid rgba(226,198,124,.4);padding:6px 14px;border-radius:99px;margin-top:10px">Très bonne affaire</span></div>`;
    return `<div class="scene" style="display:flex;align-items:center;gap:0"><img src="${ASSET.photo("g-x4iv-1")}" style="width:84px;height:110px;object-fit:cover;border-radius:10px;display:block"><div style="margin-left:-20px;background:#1A1820;border-radius:50%;padding:3px">${ring(92, 70, { label: "/100" })}</div></div>`;
  },
};

/* ----------------------------------------------------------------------------------------------
 * D — Selio Track : sache quoi acheter (chiffres d'exemple, ceux de la vidéo Track)
 * -------------------------------------------------------------------------------------------- */
const SCORES = [["Demande", 82], ["Vitesse de vente", 74], ["Concurrence", 61], ["Marge", 80]];

function curve(w, h) {
  const pts = [15, 16, 15.5, 17, 18, 17.5, 18.5, 19, 18.6, 19.4, 19, 19.6].map((v, i, a) => [(i * w) / (a.length - 1), h - ((v - 13) / 8) * h]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" style="display:block;overflow:visible"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.v500}" stop-opacity=".45"/><stop offset="1" stop-color="${C.v500}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#cg)"/><path d="${d}" fill="none" stroke="${C.v300}" stroke-width="3"/></svg>`;
}

function nicheCard(width = 640) {
  return `<div class="card" style="width:${width}px;padding:26px 28px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <small style="font-size:14px;color:${C.v300};font-weight:600;letter-spacing:.08em">NOTE DE LA NICHE</small>${ex("Exemple · chiffres fictifs")}</div>
    <div style="font-size:27px;font-weight:600;margin-bottom:18px">Pulls torsadés en laine · Homme</div>
    <div style="display:flex;gap:28px;align-items:center">
      ${ring(78, 150)}
      <div style="flex:1">${SCORES.map(([k, v]) => `<div style="margin:0 0 12px"><div style="display:flex;justify-content:space-between;font-size:17px;margin-bottom:6px"><span>${k}</span><b style="font-weight:600">${v}</b></div><div style="height:9px;border-radius:9px;background:#2D2A35"><div style="width:${v}%;height:100%;border-radius:9px;background:${C.v500}"></div></div></div>`).join("")}</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
      <div style="border:1px solid ${C.border};border-radius:12px;padding:12px 16px"><small style="font-size:14px;color:${C.muted}">Prix de revente médian</small><div style="font-size:30px;font-weight:700">19 €</div></div>
      <div style="border:1px solid ${C.border};border-radius:12px;padding:12px 16px"><small style="font-size:14px;color:${C.muted}">Fourchette habituelle</small><div style="font-size:30px;font-weight:700">14 – 26 €</div></div></div>
    <div style="margin-top:16px"><small style="font-size:14px;color:${C.muted}">Prix médian, 12 dernières semaines</small><div style="margin-top:8px">${curve(width - 56, 70)}</div></div></div>`;
}

const photoSearch = (width = 400) => `<div class="card" style="width:${width}px;padding:18px;display:flex;gap:16px;align-items:center">
  <img src="${ASSET.photo("g-x4iv-3")}" style="width:96px;height:124px;object-fit:cover;border-radius:10px;flex:none">
  <div style="line-height:1.3"><span style="display:flex;align-items:center;gap:8px;font-size:15px;color:${C.v300};font-weight:600">${ICON.camera(18)}Recherche par photo</span>
  <div style="font-size:20px;font-weight:600;margin:6px 0 4px">Se revend autour de 19 €</div><div style="font-size:15px;color:${C.muted}">Estimation à partir des ventes comparables (exemple)</div></div></div>`;

const track = {
  key: "D",
  slug: "track",
  produit: "Selio Track",
  title: "Sache <em>quoi acheter.</em>",
  titleShort: "Sache <em>quoi acheter.</em>",
  titleBanner: "Sache <em>quoi acheter</em> avant d'acheter",
  titleTiny: "Sache <em>quoi acheter</em>",
  sub: "Selio Track analyse le marché : niches notées sur 100, prix de revente, recherche par photo. Tu achètes en connaissance de cause.",
  subShort: "Niches notées sur 100, prix de revente et recherche par photo.",
  scene(kind) {
    if (kind === "focus") return `<div class="scene" style="width:640px">${nicheCard(640)}</div>`;
    if (kind === "tall") {
      return `<div class="scene" style="width:820px">
        <div style="position:relative;z-index:2">${nicheCard(820)}</div>
        <div style="position:relative;z-index:3;margin:-30px 0 0 300px">${photoSearch(520)}</div></div>`;
    }
    return `<div class="scene" style="width:1060px;height:640px">
      <div style="position:absolute;left:0;top:0;z-index:2">${nicheCard(660)}</div>
      <div style="position:absolute;right:0;top:330px;z-index:3">${photoSearch(420)}</div>
      <div style="position:absolute;right:0;top:20px;z-index:1;display:flex;flex-direction:column;gap:12px;align-items:flex-end">
        <span class="chip">${ICON.check(16, C.v300)}Niches notées sur 100</span><span class="chip">${ICON.check(16, C.v300)}Annonces disparues suivies</span><span class="chip">${ICON.check(16, C.v300)}Prix médian et fourchette</span></div></div>`;
  },
  mini(kind) {
    if (kind === "sky") return `<div class="scene" style="width:300px;display:flex;flex-direction:column;align-items:center;gap:14px">${ring(78, 190)}<div style="width:100%">${SCORES.map(([k, v]) => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:19px;margin-bottom:5px"><span>${k}</span><b>${v}</b></div><div style="height:9px;border-radius:9px;background:#2D2A35"><div style="width:${v}%;height:100%;border-radius:9px;background:${C.v500}"></div></div></div>`).join("")}</div>${ex("Exemple")}</div>`;
    return `<div class="scene" style="display:flex;flex-direction:column;align-items:center;gap:4px">${ring(78, 84, { label: "/100" })}<span style="font-size:11px;color:${C.gold};letter-spacing:.06em">EXEMPLE</span></div>`;
  },
};

export const CONCEPTS = [manager, studio, bot, track];
