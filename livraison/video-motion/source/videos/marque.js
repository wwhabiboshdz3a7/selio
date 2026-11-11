/* Films de marque en vmin : 9:16, 16:9 et 1:1. */
const FLEX = ["9x16", "16x9", "1x1"];
const fcap = (t0, t1, text, fs = 9, slam = false, step = 0.15) => `<div class="fx" style="position:absolute;left:5vmin;right:5vmin;font-size:${fs}vmin${slam ? ";font-weight:800" : ""}"><div${an(t0, slam ? "slam" : "up", 0.4)}><div${an(t1 - 0.2, "out", 0.2)}>${capWords(text, t0 + 0.05, step)}</div></div></div>${slam ? sfx("slam", t0, 1) : ""}`;
const QUESTION = { dur: 3, html: `<div class="center">${fcap(0.2, 2.95, "Et si une seule appli\n*centralisait tout ?*", 9.6)}</div>` };

reg("01-logo", { formats: FLEX, build: () => seq([
  { dur: 1.7, html: `<div class="center"><svg viewBox="0 0 200 200" style="width:62vmin;height:62vmin;transform:rotate(-90deg)">
      <circle cx="100" cy="100" r="88" fill="none" stroke="#E2C67C" stroke-width="1.2" pathLength="1" stroke-dasharray="1"${an(0.1, "draw", 1.4, "--ez:var(--io)")}/>
      <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(226,198,124,.4)" stroke-width=".6" stroke-dasharray="1 5" style="transform-origin:100px 100px;animation:spin 14s linear infinite"/></svg></div>${sfx("riser", 0.2, 1.4)}` },
  { dur: 5.6, html: endFlex() },
]) });

reg("02-des-heures", { formats: FLEX, build: () => seq([
  { dur: 5.8, html: `<div class="center"><div style="position:relative;width:100%;height:24vmin">${fcap(0.2, 2.5, "Tu passes encore\n*des heures…*", 9.6)}${fcap(2.7, 5.75, "à chercher, photographier\net republier ?", 7.4)}</div>
      <div class="timer"${an(0.5, "up", 0.5, "margin-top:7vmin")}><small>Temps passé</small><b>${count(22368, 0.6, 4.8, "hms")}</b></div></div>${sfx("tick", 0.6, 0, 38, 0.125)}` },
  QUESTION,
  { dur: 5.6, html: endFlex() },
]) });

reg("12-neuf-applis", { formats: FLEX, build: () => {
  const L = ["Les annonces sur Vinted.", "Le stock sur Excel…", "Les marges à la calculette,", "le sourcing sur Discord…", "et l'IA en copier-coller."];
  return seq([
    { dur: 3.2, html: `<div class="center">${fcap(0.2, 3.15, "Combien d'applis tu ouvres…\npour vendre *un seul pull ?*", 7.6)}</div>` },
    { dur: 5.2, html: `<div class="center" style="align-items:flex-start;padding-left:9vmin;gap:2.6vmin">${L.map((l, i) => `<div class="fx"${an(0.15 + i * 0.95, "up", 0.4, "font-size:5.8vmin;text-align:left;display:flex;gap:3vmin;align-items:center")}><span style="color:#E2C67C;font-weight:800;font-variant-numeric:tabular-nums">${i + 1}</span><span>${l}</span></div>${sfx("pop", 0.15 + i * 0.95, i)}`).join("")}</div>` },
    { dur: 2.6, html: `<div class="center">${fcap(0.1, 2.55, "*Neuf applis.*\nPour un pull.", 13, true, 0.3)}</div>` },
    QUESTION,
    { dur: 5.6, html: endFlex("Une appli.\nTout ton\n*business Vinted.*") },
  ]);
} });
