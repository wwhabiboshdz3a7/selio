// Vidéo « Selio Bot : il négocie et relance pendant que tu dors » (29 s, 1080 × 1920) : timeline + page scene.html.
import { readFileSync } from "node:fs";
import { buildPage, ph } from "../../commun/page.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const DURATION = 29;

// ---------- Sous-titres karaoké (g = or, r = rouge, v = violet) ----------
const T = 300, S = 72;
const CAPS = [
  { top: 280, size: 80, width: 1020, words: [["2 h 47.", 0.2, "v"], ["Une", 0.75], ["offre", 0.9], ["arrive…", 1.1], ["\n"], ["et", 1.7], ["toi,", 1.82], ["tu", 2.05], ["dors.", 2.18, "g"]], out: 3.0 },
  { top: T, size: S, words: [["Au", 3.1], ["réveil :", 3.22], ["sept", 3.6, "r"], ["messages", 3.78, "r"], ["\n"], ["sans", 4.15], ["réponse…", 4.32]], out: 4.95 },
  { top: T, size: S, words: [["et", 5.05], ["des", 5.15], ["acheteurs", 5.27], ["\n"], ["qui", 5.75], ["n'ont", 5.87], ["pas", 6.05], ["attendu.", 6.18, "r"]], out: 6.75 },
  { top: T, size: 84, words: [["Avec", 6.85], ["Selio", 7.05, "g"], ["Bot…", 7.3, "g"]], out: 8.5, slam: [7.3] },
  { top: T, size: S, words: [["Tu", 8.7], ["fixes", 8.82], ["tes", 9.08], ["règles", 9.2, "g"], ["\n"], ["une", 9.6], ["seule", 9.72], ["fois.", 9.92]], out: 10.9 },
  { top: T, size: 80, words: [["Une", 11.0], ["offre", 11.12], ["trop", 11.35, "r"], ["basse ?", 11.5, "r"]], out: 12.15 },
  { top: T, size: S, words: [["Il", 12.25], ["répond", 12.35], ["selon", 12.62], ["tes", 12.85], ["règles,", 12.97, "g"]], out: 13.55 },
  { top: T, size: S, words: [["sans", 13.65], ["passer", 13.82], ["sous", 14.08], ["ton", 14.22], ["\n"], ["prix", 14.35, "g"], ["plancher.", 14.5, "g"]], out: 15.9 },
  { top: T, size: S, words: [["Il", 16.05], ["relance", 16.15, "g"], ["ceux", 16.5], ["qui", 16.65], ["\n"], ["ont", 16.78], ["aimé", 16.9], ["ton", 17.1], ["article.", 17.22]], out: 19.4 },
  { top: T, size: 80, words: [["Au", 19.6], ["réveil,", 19.72], ["un", 20.1], ["résumé.", 20.22, "g"]], out: 21.2 },
  { top: T, size: S, words: [["Le", 21.3], ["reste", 21.42], ["attend", 21.66], ["\n"], ["ta", 21.95], ["validation.", 22.07, "g"]], out: 22.9 },
  { top: T, size: 84, words: [["Tu", 23.0], ["gardes", 23.15], ["la", 23.45], ["main.", 23.55, "g"]], out: 24.2, slam: [23.55] },
  { top: 290, size: 74, words: [["Il", 24.6], ["négocie", 24.72, "g"], ["et", 25.1], ["relance", 25.22, "g"], ["\n"], ["pendant", 25.6], ["que", 25.88], ["tu", 26.0], ["dors.", 26.12, "g"]], out: 28.9 },
];

// ---------- Scène ----------
const NOTIFS = [
  { t: 0.85, who: "Nouvelle offre", msg: "Léa M. propose 13,00 € pour « Pull à pois »" },
  { t: 3.3, who: "Tom R.", msg: "Toujours disponible ?" },
  { t: 3.55, who: "Nouveau favori", msg: "« Pull torsadé gris » ajouté en favori" },
  { t: 3.8, who: "Inès B.", msg: "Vous faites un lot avec le jean ?" },
  { t: 4.05, who: "Nouvelle offre", msg: "10,00 € pour « Jean droit »" },
];
const RULES = [["Prix plancher", "14,50 €", "gold"], ["Contre-offre", "Automatique, au-dessus du plancher"], ["Ton", "Poli, vouvoiement"], ["Relance des favoris", "Après 24 h"], ["Cas particulier", "Me demander"]];
const T_RULES = 8.65, T_RULE = RULES.map((_, i) => 8.95 + i * 0.22);
const T_CHAT = 10.95, B = { b0: 11.15, offer: 11.55, decide: 12.35, dots: [12.45, 13.0], b1: 13.0, b2: 15.0, ok: 15.4 };
const T_REL = 16.0, REL = [["SK", "Sarah K."], ["HP", "Hugo P."], ["ND", "Nina D."]], T_SENT = [16.95, 17.35, 17.75], T_PREV = 18.2;
const T_SUM = 19.45, SUM = [["Offres traitées", "4"], ["Contre-offres acceptées", "2"], ["Relances envoyées", "3"], ["À valider par toi", "1", "gold"]], T_SROW = SUM.map((_, i) => 20.35 + i * 0.2), T_VTAP = 22.07, T_VOK = 22.2;

const BRANDS = [{ tIn: 6.95, tOut: 8.4, y: 1150, sub: "Bot" }, { tIn: 24.35, tOut: 30, y: 830, s: 0.92, sub: "Bot" }];
const CTA = { t: 25.0, btn: "Essaie 14 jours gratuitement", bio: "Lien en bio", legal: "Outil indépendant, non affilié à Vinted. Conversation et prénoms d'exemple.<br>La nuit : ordinateur allumé, ou Selio Cloud (en option).", yBtn: 1290, yBio: 1450, yLegal: 1690 };

const SFX = [
  [0.2, "heart", 0], [NOTIFS[0].t, "notif", 0], [1.7, "heart", 1],
  [3.0, "whip", 0], [3.1, "pop", 2], ...NOTIFS.slice(1).map((n, i) => [n.t, "notif", (i + 1) % 2]), [3.6, "error", 0],
  [6.0, "thud", 0], [6.45, "suck", 0.5], [6.95, "impact", 0], [6.95, "sparkle", 0.9], [7.4, "shine", 0], [8.45, "whoosh", 1],
  [T_RULES, "swish", 0], ...T_RULE.map((t, i) => [t, "check", i]), [9.2, "pop", 3],
  [T_CHAT, "whip", 1], [B.b0, "notif", 1], [B.offer, "pop", 2], [11.5, "thud", 0], [B.decide, "blip", 1],
  ...Array.from({ length: 6 }, (_, i) => [B.dots[0] + i * 0.09, "type", i]), [B.b1, "pop", 5], [14.5, "check", 0],
  [B.b2, "notif", 0], [B.ok, "kaching", 0],
  [T_REL, "whip", 0], ...REL.map((_, i) => [16.3 + i * 0.12, "pop", i + 1]), ...T_SENT.map((t, i) => [t, "check", i]), [T_PREV, "swish", 1],
  [19.3, "whoosh", 0], [T_SUM, "shimmer", 0], ...T_SROW.map((t, i) => [t, "pop", i + 2]), [21.4, "blip", 2], [T_VTAP, "tap", 0], [T_VOK, "ding", 0], [23.55, "ding", 1],
  [23.95, "suck", 0.35], [24.35, "impact", 1], [24.35, "shine", 0], [25.0, "pop", 4], [25.5, "ding", 0],
];
const FAST = [[2.95, 3.4], [6.4, 7.4], [8.4, 9.0], [10.8, 11.3], [15.85, 16.35], [19.25, 19.8], [23.9, 24.8], [24.95, 25.5]];
const TL = {
  DURATION, CAPS, BRANDS, CTA, SFX, FAST, NOTIFS, RULES, T_RULES, T_RULE, T_CHAT, B, T_REL, REL, T_SENT, T_PREV, T_SUM, SUM, T_SROW, T_VTAP, T_VOK,
  FLASH: [[6.95, 0.9, 0.45], [24.35, 0.45, 0.35]], BURSTS: [[6.95, 540, 1150, 1], [24.35, 540, 830, 0.7]], GLOW: [[6.85, 8.7], [24.3, 29]],
  CAPBAND: [[0, 0.01, 28.9, 29]],
};

const svgI = (inner, c = "#C9BBFF", s = 34, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const I = {
  chat: '<path d="M5.2 4.6h13.6a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2h-6.6l-4.4 3.6v-3.6H5.2A2.2 2.2 0 0 1 3 15V6.8a2.2 2.2 0 0 1 2.2-2.2z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  heart: '<path d="M12 20.3s-7.6-4.6-9.3-9.2C1.4 7.6 3.6 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.3 0 5.5 3.1 4.2 6.6-1.7 4.6-9.3 9.2-9.3 9.2z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
};

const css = `
#clock { width: 900px; text-align: center; }
#clock .h { font: 800 230px/1 Inter; letter-spacing: -.04em; color: #E9E6F2; text-shadow: 0 10px 60px rgba(124,92,235,.45); }
#clock .d { margin-top: 10px; font: 600 34px Inter; color: rgba(255,255,255,.55); }
#dnd { display: flex; align-items: center; gap: 12px; padding: 14px 28px; border-radius: 99px; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.16); font: 600 30px Inter; color: #DCD6F0; white-space: nowrap; }
#unread { display: flex; align-items: center; gap: 12px; padding: 14px 28px; border-radius: 99px; font: 700 32px Inter; background: rgba(180,35,24,.4); border: 2px solid rgba(240,133,122,.85); color: #FFD9D4; white-space: nowrap; }
.notif { width: 900px; display: flex; gap: 22px; align-items: center; padding: 22px 28px; border-radius: 36px; background: rgba(246,245,250,.95); color: #1C1A24; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
.notif .ic { flex: none; width: 74px; height: 74px; border-radius: 19px; display: flex; align-items: center; justify-content: center; background: #6442D6; }
.notif .hd { font: 500 24px Inter; color: #6E6A7B; } .notif .hd b { font-weight: 700; color: #1C1A24; } .notif .msg { font: 600 30px/1.25 Inter; }
#rules, #chat, #rel, #sum { width: 900px; padding: 36px 40px 40px; }
.item { display: flex; align-items: center; gap: 20px; margin-top: 22px; padding: 16px; border-radius: 22px; background: rgba(255,255,255,.05); }
.item img { width: 84px; height: 112px; object-fit: cover; border-radius: 14px; } .item b { display: block; font: 700 30px Inter; } .item small { display: block; font: 500 24px Inter; color: rgba(255,255,255,.55); margin-top: 4px; }
.rule { display: flex; align-items: center; gap: 18px; padding: 20px 4px; border-bottom: 2px solid rgba(255,255,255,.07); }
.rule .k { flex: 1; font: 600 28px Inter; color: rgba(255,255,255,.65); } .rule .v { font: 700 30px Inter; color: #fff; text-align: right; }
.rule.gold .v { color: #F3E2B3; } .rule .tg { flex: none; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(124,92,235,.35); }
#rchip { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-radius: 99px; background: rgba(124,92,235,.2); border: 2px solid rgba(185,166,255,.45); font: 700 28px Inter; color: #E4DCFF; white-space: nowrap; }
.chd { display: flex; align-items: center; gap: 18px; padding-bottom: 22px; border-bottom: 2px solid rgba(255,255,255,.08); }
.av { flex: none; width: 66px; height: 66px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 700 26px Inter; background: #3B3450; color: #E4DCFF; }
.chd b { display: block; font: 700 32px Inter; } .chd small { display: block; font: 500 24px Inter; color: rgba(255,255,255,.5); }
#msgs { position: relative; height: 720px; }
.bub { position: absolute; max-width: 640px; padding: 20px 26px; border-radius: 30px; font: 500 31px/1.35 Inter; }
.bub.l { left: 0; background: #2E2A3A; border-bottom-left-radius: 8px; } .bub.r { right: 0; background: linear-gradient(135deg, #5232B5, #7C5CEB); border-bottom-right-radius: 8px; }
.bub small { display: block; margin-top: 8px; font: 600 20px Inter; color: rgba(255,255,255,.7); }
.tagl { position: absolute; display: inline-flex; align-items: center; gap: 10px; padding: 10px 20px; border-radius: 99px; font: 700 24px Inter; white-space: nowrap; }
.tagl.v { background: rgba(124,92,235,.22); border: 2px solid rgba(185,166,255,.5); color: #DCD2FF; } .tagl.r { background: rgba(180,35,24,.3); border: 2px solid rgba(240,133,122,.7); color: #FFD9D4; }
.tagl.g { background: rgba(34,197,94,.2); border: 2px solid rgba(74,222,128,.6); color: #BBF7D0; }
#dots { position: absolute; right: 0; display: flex; gap: 10px; padding: 24px 28px; border-radius: 30px; background: rgba(124,92,235,.35); } #dots i { width: 14px; height: 14px; border-radius: 50%; background: #fff; }
.rrow { display: flex; align-items: center; gap: 18px; padding: 18px 0; border-bottom: 2px solid rgba(255,255,255,.07); }
.rrow b { flex: 1; font: 700 30px Inter; } .rrow .st { font: 600 26px Inter; color: rgba(255,255,255,.4); display: flex; align-items: center; gap: 8px; } .rrow .st.ok { color: #86EFAC; }
#prev { margin-top: 24px; padding: 20px 24px; border-radius: 22px; background: rgba(124,92,235,.16); border: 2px dashed rgba(185,166,255,.45); font: 500 28px/1.4 Inter; color: #E9E6F2; }
#prev small { display: block; font: 700 21px Inter; letter-spacing: .1em; text-transform: uppercase; color: #B9A6FF; margin-bottom: 6px; }
.srow { display: flex; align-items: center; padding: 22px 6px; border-bottom: 2px solid rgba(255,255,255,.07); }
.srow span { flex: 1; font: 600 31px Inter; color: rgba(255,255,255,.75); } .srow b { font: 800 44px Inter; }
.srow.gold { margin-top: 10px; border: 3px solid rgba(226,198,124,.8); border-radius: 22px; padding: 18px 20px; background: rgba(226,198,124,.08); } .srow.gold span { color: #F3E2B3; }
.srow.done { border-color: rgba(74,222,128,.7); background: rgba(74,222,128,.08); } .srow.done span { color: #BBF7D0; }
#vbtn { font-style: normal; margin-left: 18px; padding: 14px 26px; border-radius: 18px; font: 700 28px Inter; background: linear-gradient(90deg, #5232B5, #7C5CEB); white-space: nowrap; }
.top { display: flex; align-items: center; justify-content: space-between; }
`;

const notifHtml = (n, i) => `<div class="sp notif" id="nt${i}"><span class="ic">${svgI(I.chat, "#fff", 44)}</span><div><div class="hd"><b>${n.who}</b> · maintenant</div><div class="msg">${n.msg}</div></div></div>`;
const body = `
<div class="layer" id="scene">
  <div class="sp" id="clock"><div class="h" id="clockh">02:47</div><div class="d" id="clockd">Écran verrouillé</div></div>
  <div class="sp" id="dnd">${svgI(I.moon, "#C9BBFF", 32)}Ne pas déranger</div>
  <div class="sp" id="unread">7 messages sans réponse</div>
  ${TL.NOTIFS.map(notifHtml).join("")}
  <div class="sp card" id="rules"><div class="top"><div class="kicker">Selio Bot · tes règles</div>${svgI(I.shield, "#B9A6FF", 40)}</div>
    <div class="item"><img src="${ph("g-yw5b-1")}"/><div><b>Pull à pois Tommy Hilfiger</b><small>Prix affiché : 18,00 €</small></div></div>
    ${RULES.map(([k, v, c], i) => `<div class="rule${c ? " " + c : ""}" id="ru${i}"><span class="tg">${svgI(I.check, "#fff", 26, 3)}</span><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}
  </div>
  <div class="sp" id="rchip">${svgI(I.shield, "#C9BBFF", 30)}Règles actives · plancher 14,50 €</div>
  <div class="sp card" id="chat">
    <div class="chd"><span class="av">LM</span><div><b>Léa M.</b><small>Pull à pois Tommy Hilfiger · 18,00 €</small></div></div>
    <div id="msgs">
      <div class="bub l" id="b0" style="top:36px">Bonjour ! Vous me le feriez à 13 € ?</div>
      <div class="tagl v" id="toffer" style="top:170px;left:0">Offre détectée : 13,00 €</div>
      <div class="tagl r" id="tdec" style="top:240px;right:0">Sous ton plancher · contre-offre</div>
      <div id="dots" style="top:320px"><i></i><i></i><i></i></div>
      <div class="bub r" id="b1" style="top:320px">Bonjour ! Je peux vous le proposer à 17,10 €, avec un envoi rapide.<small>Selio Bot · selon tes règles</small></div>
      <div class="bub l" id="b2" style="top:530px">D'accord, je le prends à 17,10 € !</div>
      <div class="tagl g" id="tok" style="top:640px;right:0">${svgI(I.check, "#86EFAC", 26, 3)}Contre-offre acceptée</div>
    </div>
  </div>
  <div class="sp card" id="rel"><div class="top"><div class="kicker">Relance après 24 h</div>${svgI(I.heart, "#F0857A", 40)}</div>
    <div class="item"><img src="${ph("g-x4iv-1")}"/><div><b>Pull torsadé gris et écru</b><small>3 favoris, pas encore d'offre</small></div></div>
    ${REL.map(([a, n], i) => `<div class="rrow"><span class="av">${a}</span><b>${n}</b><span class="st" id="st${i}"></span></div>`).join("")}
    <div id="prev"><small>Message envoyé</small>Bonjour ! Le pull torsadé vous intéresse toujours ? Il est encore disponible.</div>
  </div>
  <div class="sp card" id="sum"><div class="top"><div class="kicker">Ta nuit en résumé</div><span class="badge">Exemple</span></div>
    <div style="height:14px"></div>
    ${SUM.map(([k, v, c], i) => `<div class="srow${c ? " " + c : ""}" id="sr${i}"><span>${k}</span>${c ? `<b id="sv">${v}</b><em id="vbtn">Valider</em>` : `<b>${v}</b>`}</div>`).join("")}
  </div>
  <div class="tap" id="tap"></div>
</div>`;

buildPage({ here: HERE, TL, css, body, sceneJs: readFileSync(`${HERE}scene.js`, "utf8") });
