/* Selio Pro (vertical 1080x1920) : tableau de bord, automatisations, ventes, stock, communaute. Tutoiement comme dans l'app. */
const demo = `<div class="abs"${an(1.2, "fade", 0.8, "left:0;right:0;bottom:60px;text-align:center;font-size:26px;color:var(--mut);letter-spacing:.06em")}>Données de démonstration</div>`;
const proChip = (d = 0.1) => `<div class="chip glass"${an(d, "down", 0.7, "font-size:36px;padding:16px 36px")}><span style="width:34px;height:34px;display:block">${ic.bolt("#d9a441")}</span>Selio Pro</div>`;
const intro = (title, dur = 2.8, size = 108) => ({ dur, cls: "deep", html: `<div class="chev-bg"></div><div class="orb loop" style="--an:floatA;--du:8s;width:700px;height:700px;right:-300px;bottom:-200px;opacity:.6"></div>
  <div class="center" style="padding:0 70px">${proChip()}<div class="disp" style="font-size:${size}px;margin-top:50px">${words(title, 0.3, 0.09)}</div></div>` });
const punch = (title, cls = "navy t-wipe", dur = 2.9, size = 112) => ({ dur, cls, html: `<div class="chev-bg"></div><div class="center" style="padding:0 70px"><div class="disp" style="font-size:${size}px">${words(title, 0.45, 0.09)}</div></div>` });
const toggle = (d) => `<div class="tog"${an(d, "bgTo", 0.35, "--to:var(--ok)")}><i${an(d, "knob", 0.45, "--ez:var(--back)")}></i><div class="tapc"${an(d - 0.1, "ripple", 0.7, "left:50%;top:50%;--ez:ease-out")}></div></div>`;
const bubAuto = (txt, d, label = "AUTO") => `<div class="bub me"${an(d, "left", 0.7)}><div class="tag"><span style="width:24px;height:24px;display:block">${ic.bolt("#d9a441")}</span>${label}</div>${txt}</div>`;
const typingB = (d0, d1, top) => `<div class="bub me"${an(d0, "blip", d1 - d0, `position:absolute;right:0;top:${top}px;--ez:linear`)}><span class="typing"><b style="background:#fff"></b><b style="background:#fff"></b><b style="background:#fff"></b></span></div>`;

reg("06-pro-tableau-de-bord", {
  formats: V,
  build: () => {
    const st = (l, v, i) => `<div class="stat"${an(0.7 + i * 0.13, "upBig", 0.9, `position:absolute;left:${80 + (i % 2) * 472}px;top:${470 + Math.floor(i / 2) * 250}px;width:448px`)}><div class="l">${l}</div><div class="v">${v}</div></div>`;
    const bars = [38, 52, 44, 68, 58, 82, 74, 100];
    return seq([
      intro("Le centre\nde pilotage de\n*ta revente.*"),
      { dur: 6.4, cls: "light t-up", html: `${head("Espace Pro", "Vue d'ensemble")}
        ${st("Ventes", count(48, 1.0, 1.6), 0)}${st("Chiffre d'affaires", count(1284, 1.1, 1.8, "eur0"), 1)}${st("Marge nette", count(612, 1.2, 1.8, "eur0"), 2)}${st("Articles en stock", count(37, 1.3, 1.6), 3)}
        <div class="card abs"${an(1.5, "upBig", 1, "left:80px;top:1000px;width:920px;height:720px;padding:50px")}>
          <div class="row" style="justify-content:space-between"><div style="font-size:38px;font-weight:700;color:var(--pd)">Ventes par semaine</div><div class="chip ok"${an(3.4, "pop", 0.6, "--ez:var(--back)")}>En hausse</div></div>
          <div class="row" style="gap:26px;align-items:flex-end;height:470px;margin-top:60px;border-bottom:3px solid var(--bd)">
            ${bars.map((b, i) => `<div${an(2.0 + i * 0.09, "growY", 0.9, `flex:1;height:${b}%;border-radius:16px 16px 0 0;transform-origin:bottom;background:${i === 7 ? "var(--p)" : "#a9c0d2"}`)}></div>`).join("")}</div>
          <div class="row" style="gap:26px;margin-top:14px;font-size:24px;color:var(--mut);text-align:center">${bars.map((_, i) => `<div style="flex:1">S${i + 1}</div>`).join("")}</div>
        </div>${demo}` },
      punch("Ventes. Stock. Marge.\n*Tout au même endroit.*"),
      { dur: 4.2, cls: "navy t-circle", html: endCard("Pilote ta revente\ncomme un pro", "Espace Selio Pro") },
    ]);
  },
});

reg("07-automatisations", {
  formats: V,
  build: () => {
    const rules = [["heart", "Message à la mise en favori"], ["clock", "Relance sans réponse"], ["tag", "Négociation automatique"], ["msg", "Message après la vente"], ["loop", "Republication automatique"]];
    return seq([
      intro("Et si ta boutique\ntravaillait\n*toute seule ?*"),
      { dur: 6.4, cls: "light t-up", html: `${head("Selio Pro", "Automatisations")}
        ${rules.map(([i, l], n) => `<div class="card row"${an(0.6 + n * 0.14, "upBig", 0.9, `position:absolute;left:80px;top:${470 + n * 248}px;width:920px;height:212px;padding:0 44px;gap:34px`)}>
          <div style="width:108px;height:108px;border-radius:30px;background:#e4edf4;padding:26px;flex:none">${i === "heart" ? ic.heart("none", "#204868") : ic[i]("#204868")}</div>
          <div style="flex:1;font-size:40px;font-weight:700;color:var(--pd);line-height:1.15">${l}</div>${toggle(2.0 + n * 0.5)}</div>`).join("")}` },
      { dur: 4.2, cls: "navy t-circle", html: `<div class="chev-bg"></div><div class="center">
          <div style="position:relative;width:560px;height:560px">
            <svg viewBox="0 0 200 200" style="position:absolute;inset:0;transform:rotate(-90deg)"><circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="8"/><circle cx="100" cy="100" r="90" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" pathLength="1" stroke-dasharray="1"${an(0.5, "draw", 2.6, "--ez:var(--io)")}/></svg>
            <div class="center"><div style="font-size:190px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums">${count(15, 0.5, 2.6)}</div><div style="font-size:52px;font-weight:600;color:var(--pl)">minutes</div></div></div>
          <div class="disp" style="font-size:86px;margin-top:90px">${words("Tes règles tournent\n*toutes les 15 minutes.*", 0.9, 0.08)}</div></div>` },
      { dur: 4.2, cls: "navy t-fade", html: endCard("Tu vends.\nSelio s'occupe du suivi.", "Automatisations · Selio Pro") },
    ]);
  },
});

reg("08-negociation-auto", {
  formats: V,
  build: () => seq([
    intro("Marre de négocier\n*chaque offre ?*"),
    { dur: 8, cls: "light t-up", html: `${head("Automatisation", "Négociation\nautomatique")}
      <div class="card abs"${an(0.5, "upBig", 0.9, "left:80px;top:560px;width:920px;padding:44px 50px")}>
        <div class="row" style="justify-content:space-between"><div style="font-size:36px;font-weight:700;color:var(--mut)">Remise maximale acceptée</div><div style="font-size:60px;font-weight:700;color:var(--p)">${count(10, 0.9, 1, "pct")}</div></div>
        <div style="height:16px;border-radius:9px;background:var(--bd);margin-top:26px;position:relative"><div${an(0.9, "widthTo", 1, "--w:40%;height:100%;border-radius:9px;background:var(--p);position:relative")}><div style="position:absolute;right:-26px;top:-18px;width:52px;height:52px;border-radius:50%;background:#fff;border:6px solid var(--p);box-shadow:0 8px 16px -6px rgba(12,27,39,.5)"></div></div></div></div>
      <div class="abs chat" style="left:80px;top:900px;width:920px">
        <div class="row" style="gap:24px"><div class="av"${an(2.1, "pop", 0.5, "background:var(--sage)")}>T</div><div class="bub them"${an(2.1, "right", 0.7)}>Bonjour ! 29 € pour la veste, ça irait ?</div></div>
        ${typingB(3.0, 3.9, 215)}
        ${bubAuto("Offre acceptée ! Elle est à toi pour 29 €.", 4.0)}
        <div class="bub sys"${an(5.2, "pop", 0.6, "--ez:var(--back)")}>32 € → 29 € · remise de 9 %, dans ta limite</div>
      </div>` },
    punch("Tu fixes la limite.\n*Selio répond.*"),
    { dur: 4.2, cls: "navy t-circle", html: endCard("Accepte ou refuse\nsans y penser", "Négociation automatique · Selio Pro") },
  ]),
});

reg("09-favori-et-relance", {
  formats: V,
  build: () => seq([
    { dur: 3.6, cls: "creamy", html: `<div${an(0.2, "upBig", 1, "position:absolute;left:170px;top:560px")}>${lst("veste", ' style="--cw:740px"', heartBtn(1.3))}</div>
      <div class="card row"${an(1.7, "down", 0.9, "position:absolute;left:80px;top:150px;width:920px;padding:36px 44px;gap:30px;--ez:var(--back)")}>
        <div class="av" style="background:var(--terra)">C</div><div><div style="font-size:38px;font-weight:700;color:var(--pd)">Nouveau favori</div><div style="font-size:32px;color:var(--mut)">@camille aime ta Veste en jean vintage</div></div></div>` },
    { dur: 8.2, cls: "light t-up", html: `${head("Automatisation", "Selio écrit\nà ta place")}
      <div class="abs chat" style="left:80px;top:640px;width:920px;gap:70px">
        ${typingB(0.6, 1.4, 0)}
        ${bubAuto("Bonjour ! J'ai vu que la veste te plaisait. Une question ? Je suis là.", 1.5, "AUTO · FAVORI")}
        <div class="bub sys"${an(3.0, "pop", 0.6, "background:#e4edf4;color:var(--p);--ez:var(--back)")}>2 jours sans réponse…</div>
        ${bubAuto("Toujours intéressée ? Elle est encore disponible.", 4.0, "AUTO · RELANCE")}
        <div class="row" style="gap:24px"><div class="av"${an(5.6, "pop", 0.5, "background:var(--terra)")}>C</div><div class="bub them"${an(5.6, "right", 0.7)}>Oui ! Je la prends.</div></div>
      </div>` },
    punch("Ne laisse plus filer\n*un acheteur.*"),
    { dur: 4.2, cls: "navy t-circle", html: endCard("Message au favori,\nrelance automatique", "Automatisations · Selio Pro") },
  ]),
});

reg("10-ventes-export-excel", {
  formats: V,
  build: () => {
    const rows = [["Veste en jean vintage", "32,00", "1,60", "+18,40"], ["Sac en cuir camel", "45,00", "2,25", "+24,75"], ["Baskets blanches", "38,00", "1,90", "+16,10"], ["Pull en laine sauge", "19,00", "0,95", "+9,05"]];
    return seq([
      intro("Ta compta\nde revendeur,\n*sans prise de tête.*"),
      { dur: 7, cls: "light t-up", html: `${head("Selio Pro", "Ventes &\ncomptabilité")}
        <div class="card abs tbl"${an(0.5, "upBig", 1, "left:60px;top:590px;width:960px;overflow:hidden")}>
          <div class="tr th"><div>Article</div><div class="n">Prix</div><div class="n">Frais</div><div class="n">Marge</div></div>
          ${rows.map((r, i) => `<div class="tr"${an(1.0 + i * 0.22, "right", 0.7)}><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r[0]}</div><div class="n">${r[1]} €</div><div class="n" style="color:var(--mut)">${r[2]} €</div><div class="n g">${r[3]} €</div></div>`).join("")}
          <div class="tr"${an(2.1, "fade", 0.6, "background:var(--surf);font-weight:700;font-size:36px")}><div>Marge nette</div><div></div><div></div><div class="n g" style="white-space:nowrap">+${count(68.3, 2.2, 1.2, "eur")}</div></div>
        </div>
        <div class="btn abs"${an(3.2, "up", 0.8, "left:190px;top:1400px;width:700px;background:var(--ok)")}><span style="width:48px;height:48px;display:block">${ic.dl()}</span><span${an(4.2, "press", 0.4)}>Exporter en Excel</span><div class="shine"${an(3.7, "shine", 1)}></div></div>${tap(540, 1455, 4.2)}
        <div class="card row"${an(4.7, "upBig", 0.9, "position:absolute;left:150px;top:1590px;width:780px;padding:30px 36px;gap:28px;--ez:var(--back)")}>
          <div style="width:96px;height:112px;border-radius:16px;background:var(--ok);color:#fff;font-weight:700;font-size:28px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;flex:none">XLSX</div>
          <div><div style="font-size:34px;font-weight:700;color:var(--pd)">selio-comptabilite.xlsx</div><div style="font-size:28px;color:var(--ok);font-weight:600">Téléchargé</div></div></div>${demo.replace("bottom:60px", "bottom:30px")}` },
      punch("Prix, frais, port, marge.\n*Un clic, un fichier.*", "navy t-wipe", 2.9, 100),
      { dur: 4.2, cls: "navy t-circle", html: endCard("Tes ventes, ta marge,\nton export Excel", "Ventes & comptabilité · Selio Pro") },
    ]);
  },
});

reg("11-dressing-et-stock", {
  formats: V,
  build: () => {
    const rows = [["veste", "Acheté 12 €", 2.2, 4.0], ["sac", "Acheté 18 €", 2.6, null], ["basket", "Acheté 20 €", 3.0, 4.6], ["pull", "Acheté 8 €", null, null], ["jean", "Acheté 10 €", 3.4, null]];
    const chipSw = (a, b, c) => `<div style="position:relative;width:230px;height:70px;flex:none">
      <div class="chip sw">En stock</div>
      ${a ? `<div class="chip blue sw"${an(a, "pop", 0.5, "--ez:var(--back)")}>En vente</div>` : ""}
      ${b ? `<div class="chip ok sw"${an(b, "pop", 0.5, "--ez:var(--back)")}>Vendu</div>` : ""}</div>`;
    return seq([
      intro("Ton stock,\n*sous contrôle.*", 2.6, 124),
      { dur: 6.6, cls: "light t-up", html: `${head("Selio Pro", "Dressing & stock")}
        ${rows.map(([k, sub, a, b], n) => { const i = ITEMS[k]; return `<div class="card row"${an(0.55 + n * 0.13, "upBig", 0.9, `position:absolute;left:80px;top:${470 + n * 250}px;width:920px;height:214px;padding:0 36px;gap:32px`)}>
          <div style="width:150px;height:150px;border-radius:28px;background:${i.bg};padding:20px;flex:none">${garment(i.g, i.c, i.k)}</div>
          <div style="flex:1;min-width:0"><div style="font-size:36px;font-weight:700;color:var(--pd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.t}</div><div style="font-size:30px;color:var(--mut);margin-top:4px">${sub}</div></div>${chipSw(a, b)}</div>`; }).join("")}${demo.replace("bottom:60px", "bottom:110px")}` },
      punch("En stock.\nEn vente.\n*Vendu.*", "navy t-wipe", 2.9, 130),
      { dur: 4.2, cls: "navy t-circle", html: endCard("Chaque pièce suivie,\nde l'achat à la vente", "Dressing & stock · Selio Pro") },
    ]);
  },
});

reg("12-communaute", {
  formats: V,
  build: () => {
    const spaces = [["Friperie & vintage", "var(--terra)", "F"], ["Sneakers", "var(--p)", "S"], ["Débuter la revente", "var(--sage)", "D"]];
    const lb = [["Léa", 100, "var(--must)"], ["Inès", 82, "var(--p)"], ["Tom", 66, "var(--terra)"], ["Zoé", 51, "var(--sage)"], ["Nour", 38, "var(--pl)"]];
    return seq([
      { dur: 3, cls: "navy", html: `<div class="chev-bg"></div><div class="center" style="padding:0 70px">${proChip()}<div class="disp" style="font-size:86px;margin-top:50px">${words("Vendre seul, c'est bien.\n*Ensemble, c'est mieux.*", 0.3, 0.08)}</div></div>` },
      { dur: 4.8, cls: "light t-up", html: `${head("Communauté", "Rejoins\nun espace")}
        ${spaces.map(([n, c, l], i) => `<div class="card row"${an(0.6 + i * 0.16, "upBig", 0.9, `position:absolute;left:80px;top:${580 + i * 260}px;width:920px;height:220px;padding:0 40px;gap:32px`)}>
          <div class="av" style="width:124px;height:124px;border-radius:36px;font-size:54px;background:${c}">${l}</div>
          <div style="flex:1;font-size:42px;font-weight:700;color:var(--pd)">${n}</div>
          ${i === 0 ? `<div style="position:relative;width:250px;height:84px"><div class="btn out"${an(2.3, "out", 0.2, "position:absolute;inset:0;font-size:32px;padding:0")}>Rejoindre</div><div class="btn"${an(2.3, "pop", 0.5, "position:absolute;inset:0;font-size:32px;padding:0;background:var(--ok);--ez:var(--back)")}>Membre</div><div class="tapc"${an(2.2, "ripple", 0.7, "left:50%;top:50%;--ez:ease-out")}></div></div>` : `<div class="btn out" style="width:250px;height:84px;font-size:32px;padding:0">Rejoindre</div>`}</div>`).join("")}
        <div class="card"${an(2.9, "upBig", 0.9, "position:absolute;left:80px;top:1390px;width:920px;padding:40px 44px;--ez:var(--back)")}><div class="row" style="gap:20px"><div class="chip blue">Annonce</div><div style="font-size:28px;color:var(--mut)">Friperie & vintage</div></div>
          <div style="font-size:40px;font-weight:700;color:var(--pd);margin-top:20px;line-height:1.2">Guide : bien photographier ses pièces</div></div>` },
      { dur: 4.8, cls: "light t-left", html: `${head("Communauté", "Classement\ndes vendeurs")}
        ${lb.map(([n, w, c], i) => `<div class="row"${an(0.6 + i * 0.14, "right", 0.8, `position:absolute;left:80px;top:${600 + i * 210}px;width:920px;gap:28px`)}>
          <div class="disp" style="font-size:64px;width:60px;color:${i ? "var(--mut)" : "var(--must)"}">${i + 1}</div><div class="av" style="width:120px;height:120px;font-size:48px;background:${c}">${n[0]}</div>
          <div style="flex:1"><div class="row" style="gap:14px;font-size:38px;font-weight:700;color:var(--pd)">${n}${i ? "" : `<span${an(2.2, "spinIn", 0.8, "width:46px;height:46px;display:block;--ez:var(--back)")}>${ic.star()}</span>`}</div>
          <div style="height:26px;border-radius:13px;background:var(--bd);margin-top:14px;overflow:hidden"><div${an(1.0 + i * 0.14, "growX", 1.2, `width:${w}%;height:100%;border-radius:13px;background:${c};transform-origin:left`)}></div></div></div></div>`).join("")}${demo}` },
      { dur: 4.2, cls: "navy t-circle", html: endCard("Des espaces pour\nprogresser ensemble", "Communauté · Selio Pro") },
    ]);
  },
});
