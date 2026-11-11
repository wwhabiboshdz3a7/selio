/* Marketplace (vertical 1080x1920) : vendre, acheter, echanger. */
const V = ["9x16"];
const head = (kick, title, d = 0.15, color = "var(--pd)") => `
  <div class="kicker abs"${an(d, "right", 0.7, `left:80px;top:150px;color:var(--pl)`)}>${kick}</div>
  <div class="abs disp" style="left:80px;top:205px;width:940px;font-size:88px;color:${color}">${words(title, d + 0.1, 0.07)}</div>`;
const stepN = (n) => `<div class="abs disp"${an(0.25, "zoomIn", 0.9, "right:60px;top:70px;font-size:420px;font-weight:800;line-height:1;color:transparent;-webkit-text-stroke:4px #c9d9e5")}>${n}</div>`;
const heartBtn = (d) => `<div class="heartb"${an(d, "heart", 0.6, "--ez:ease-out")}><div class="tapc"${an(d - 0.12, "ripple", 0.7, "left:50%;top:50%;--ez:ease-out")}></div><svg viewBox="0 0 24 24" stroke-width="2.2" stroke-linejoin="round"><path${an(d, "fillOn", 0.2, "fill:rgba(0,0,0,0);stroke:#51677a;--to:#c9785c")} d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg></div>`;

reg("03-vendre-en-3-etapes", {
  formats: V,
  build: () => {
    const v = ITEMS.veste;
    const sel = (label, d, on) => `<div class="chip"${on ? an(d, "bgTo", 0.3, "--to:var(--p)") : ""}><span${on ? an(d, "colorTo", 0.3, "--to:#fff") : ""}>${label}</span>${on ? `<div class="tapc"${an(d - 0.12, "ripple", 0.7, "left:50%;top:50%;--ez:ease-out")}></div>` : ""}</div>`;
    return seq([
      { dur: 2.8, cls: "navy", html: `<div class="chev-bg"></div>${gFloat("veste", 120, 1180, 380, -10, 0.5)}${gFloat("sac", 600, 1340, 320, 9, 0.7)}
        <div class="center" style="justify-content:flex-start;padding-top:420px"><div class="chip glass"${an(0.1, "down", 0.7)}>Vendre sur Selio</div>
        <div class="disp" style="font-size:124px;margin-top:40px">${words("3 étapes.\n*Quelques minutes.*", 0.3, 0.1)}</div></div>` },
      { dur: 3.6, cls: "light t-up", html: `${stepN(1)}${head("Étape 1", "Prenez\nvos photos")}
        <div class="card abs"${an(0.5, "upBig", 1, "left:140px;top:560px;width:800px;height:800px;overflow:hidden;background:#e4edf4;display:flex;align-items:center;justify-content:center")}>
          <div style="width:70%;height:70%">${garment(v.g, v.c, v.k)}</div>
          <div class="abs"${an(1.35, "out", 0.5, "inset:0;background:#fff;--ez:ease-out")}></div>
          <div class="abs" style="inset:50px;border:5px solid rgba(32,72,104,.35);border-radius:24px"></div></div>
        <div class="abs"${an(1.2, "press", 0.4, "left:460px;top:1290px;width:160px;height:160px;border-radius:50%;background:var(--p);padding:42px;box-shadow:0 0 0 12px #fff,0 30px 50px -16px rgba(12,27,39,.5)")}>${ic.cam("#fff")}</div>
        ${[0, 1, 2].map((i) => `<div class="card abs"${an(1.75 + i * 0.16, "pop", 0.7, `left:${170 + i * 260}px;top:1530px;width:220px;height:220px;border-radius:28px;background:${["#e4edf4", "#dfe9e0", "#f5efe6"][i]};padding:${28 + i * 10}px;--ez:var(--back)`)}>${garment(v.g, v.c, v.k)}</div>`).join("")}` },
      { dur: 4.2, cls: "light t-left", html: `${stepN(2)}${head("Étape 2", "Décrivez,\nfixez le prix")}
        <div class="card abs"${an(0.45, "upBig", 1, "left:80px;top:560px;width:920px;padding:56px")}>
          <div class="lab">Titre</div><div class="inp">${type("Veste en jean vintage", 0.9, 18)}</div>
          <div class="lab" style="margin-top:40px">Catégorie</div><div class="row" style="gap:16px">${sel("Femmes", 2.2, true)}${sel("Hommes")}${sel("Sacs")}</div>
          <div class="lab" style="margin-top:40px">État</div><div class="row" style="gap:16px">${sel("Neuf")}${sel("Très bon état", 2.55, true)}${sel("Bon état")}</div>
          <div class="row" style="gap:28px;margin-top:40px"><div style="flex:1"><div class="lab">Taille</div><div class="inp">${type("M", 2.9, 8, false)}</div></div>
          <div style="flex:1.4"><div class="lab">Prix</div><div class="inp" style="font-weight:700;font-size:46px;color:var(--p)">${count(32, 3.0, 0.9, "eur")}</div></div></div>
        </div>` },
      { dur: 3.6, cls: "light t-left", html: `${stepN(3)}${head("Étape 3", "Publiez")}
        <div class="btn abs"${an(0.5, "up", 0.8, "left:230px;top:520px;width:620px")}><span${an(1.1, "press", 0.4)}>Publier l'annonce</span><div class="shine"${an(0.9, "shine", 1)}></div></div>${tap(540, 570, 1.1)}
        <div${an(1.45, "upBig", 1, "position:absolute;left:230px;top:740px;--ez:var(--back)")}>${lst("veste", ' style="--cw:620px"')}</div>
        <div class="chip ok abs"${an(2.1, "pop", 0.6, "left:610px;top:700px;font-size:36px;padding:16px 34px;--ez:var(--back);box-shadow:0 20px 30px -14px rgba(26,127,90,.6)")}><span style="width:36px;height:36px;display:block">${ic.check("#1a7f5a")}</span>En ligne</div>` },
      { dur: 4.2, cls: "navy t-circle", html: endCard("Votre dressing vaut\nplus que vous ne pensez", "Vendez en quelques minutes") },
    ]);
  },
});

reg("04-acheter", {
  formats: V,
  build: () => {
    const grid = ["veste", "robe", "basket", "sac"].map((k, i) => `<div${an(1.9 + i * 0.14, "upBig", 1, `position:absolute;left:${90 + (i % 2) * 480}px;top:${590 + Math.floor(i / 2) * 650}px`)}>${lst(k, ' style="--cw:420px"', heartBtn(i === 0 ? 4.1 : 99))}</div>`).join("");
    const f = (l, on, d) => `<div class="chip${on ? " on" : ""}"${an(d, "left", 0.6)}>${l}</div>`;
    return seq([
      { dur: 6.2, cls: "light", html: `${wm("left:80px;top:110px", "var(--p)", 0)}
        <div class="card abs"${an(0.2, "up", 0.8, "left:80px;top:220px;width:920px;border-radius:999px;padding:30px 44px;display:flex;gap:24px;align-items:center;font-size:42px")}><span style="width:52px;height:52px">${ic.search()}</span><span>${type("veste en jean", 0.6, 14)}</span></div>
        <div class="row abs" style="left:80px;top:420px;gap:16px">${f("Femmes", true, 1.5)}${f("Très bon état", false, 1.6)}${f("Taille M", false, 1.7)}${f("Prix", false, 1.8)}</div>
        ${grid}` },
      { dur: 3.4, cls: "navy t-circle", style: "--cx:42%;--cy:37%", html: `<div class="chev-bg"></div>${gFloat("robe", 90, 190, 330, -10, 0.4)}${gFloat("basket", 650, 260, 340, 8, 0.55)}${gFloat("sac", 130, 1370, 320, 8, 0.7)}${gFloat("pull", 620, 1400, 360, -8, 0.85)}
        <div class="center" style="padding:0 70px"><div class="disp" style="font-size:112px">${words("Trouvez la pièce\n*qui vous attendait.*", 0.5, 0.09)}</div></div>` },
      { dur: 4.2, cls: "navy t-fade", html: endCard("La seconde main,\nsélectionnée avec soin", "Recherchez · Filtrez · Craquez") },
    ]);
  },
});

reg("05-coup-de-coeur", {
  formats: V,
  build: () => seq([
    { dur: 3.4, cls: "creamy", html: `<div class="abs disp" style="left:80px;top:170px;font-size:120px;color:var(--pd)">${words("Un coup\nde *cœur ?*", 0.15, 0.1)}</div>
      <div${an(0.5, "upBig", 1.1, "position:absolute;left:190px;top:640px;--ez:var(--back)")}><div class="loop" style="--an:floatA;--du:5s;--fy:-18px;--fx:0px;--r:-3deg;--fr:2deg">${lst("robe", ' style="--cw:700px"', heartBtn(1.8).replace('class="heartb"', 'class="heartb" data-big'))}</div></div>
            ${[0, 1, 2, 3, 4].map((i) => `<div class="abs"${an(1.85 + i * 0.07, "moveFade", 1.3, `left:770px;top:700px;width:${50 + i * 12}px;--x1:${[-260, 120, -90, 200, -10][i]}px;--y1:${-380 - i * 70}px;--r1:${-30 + i * 15}deg;--s0:.2;--ez:ease-out`)}><div${an(2.5 + i * 0.07, "out", 0.6)}>${ic.heart("#c9785c", "#c9785c")}</div></div>`).join("")}` },
    { dur: 6.2, cls: "light t-up", html: `${head("Messagerie", "Écrivez\nau vendeur")}
      <div class="abs chat" style="left:80px;top:620px;width:920px">
        <div class="row" style="gap:24px;align-self:flex-end"><div class="bub me"${an(0.9, "left", 0.7)}>Bonjour ! La robe est toujours disponible ?</div></div>
        <div class="bub them"${an(1.2, "blip", 0.65, "position:absolute;top:250px;--ez:linear")}><span class="typing"><b></b><b></b><b></b></span></div>
        <div class="row" style="gap:24px"><div class="av"${an(1.9, "pop", 0.5, "background:var(--terra)")}>C</div><div class="bub them"${an(1.9, "right", 0.7)}>Oui, toujours ! Elle taille un bon 38.</div></div>
        <div class="bub me"${an(3.0, "left", 0.7)}>Parfait, c'est ma taille.</div>
        <div class="row" style="gap:24px"><div class="av"${an(4.0, "pop", 0.5, "background:var(--terra)")}>C</div><div class="bub them"${an(4.0, "right", 0.7)}>Super ! Je vous la mets de côté.</div></div>
      </div>` },
    { dur: 4.2, cls: "navy t-circle", html: endCard("Favoris, messages :\néchangez en direct", "Entre passionnés de seconde main") },
  ]),
});
