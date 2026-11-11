/* Confiance et « comment ça marche » : réponses de la FAQ (packages/domain/src/help-text.ts), en vidéo. */
const typo = (o) => ({ dur: o.dur, html: `${chip(o.chip)}${caps(o.caps)}${o.rows.map(([t, no], i) => crow((o.t0 ?? 0.9) + i * (o.step ?? 0.7), (o.y ?? 640) + i * 165, t, no)).join("")}${o.extra || ""}` });
const bar = (d, y, label, pts) => `<div class="bar"${an(d, "up", 0.45, `top:${y}px`)}><div class="t"><span>${label}</span><b>${pts} pts</b></div><div class="tr"><i${an(d + 0.15, "growX", 0.9, `width:${(pts / 30) * 100}%`)}></i></div></div>${sfx("pop", d, 2)}`;

reg("27-mot-de-passe", { formats: V, build: () => seq([
  typo({ dur: 10, chip: "Sécurité", caps: [[0.3, 3.2, "Ton mot de passe Vinted ?\n*Jamais demandé.*", { fs: 80 }], [3.4, 6.6, "Selio passe par\n*son extension,*"], [6.8, 9.9, "dans le navigateur où\n*tu es déjà connecté.*", { fs: 80 }]],
    t0: 3.8, y: 700, rows: [["Aucun mot de passe lu ni stocké"], ["Aucun cookie"], ["Aucune session Vinted"]] }),
  END(undefined, 0),
]) });

reg("28-l-ia-redige", { formats: V, build: () => seq([
  typo({ dur: 10.4, chip: "Mon IA perso", caps: [[0.3, 3.2, "L'IA *rédige.*", { slam: true, fs: 130 }], [3.4, 6.6, "Elle ne\n*décide rien.*", { slam: true, fs: 120 }], [6.8, 10.3, "Accepter, contre-proposer,\nrefuser : *tes règles.*", { fs: 76 }]],
    t0: 0.9, step: 0.6, rows: [["Annonces à partir des photos"], ["Réponses aux acheteurs"], ["Réponses de l'aide"]],
    extra: crow(4.2, 1200, "Chaque sortie est vérifiée") + crow(4.9, 1365, "Ton plancher n'est jamais révélé") }),
  END(APPLI, 2),
]) });

reg("29-note-sur-100", { formats: V, build: () => seq([
  { dur: 10.4, html: `${chip("Dressing intelligent")}${caps([[0.3, 3.0, "Chaque annonce\nnotée *sur 100.*"], [3.2, 6.9, "Quatre critères,\n*rien de caché.*"], [7.1, 10.3, "*80 et plus :*\nexcellente."]])}
      ${bar(0.9, 600, "Visibilité", 25)}${bar(1.4, 760, "Attractivité", 25)}${bar(1.9, 920, "Qualité de l'annonce", 30)}${bar(2.4, 1080, "Prix face au marché", 20)}
      ${heroB(3.2, 99, 1270, count(100, 3.3, 2.2, "int"), 360)}<div class="kick"${an(3.6, "fade", 0.5, "top:1660px")}>points, avec ce qu'il faut améliorer</div>` },
  END(undefined, 5),
]) });

reg("30-prix-plancher", { formats: V, build: () => seq([
  typo({ dur: 10, chip: "Négociation", caps: [[0.3, 3.2, "Ton *prix plancher* :"], [3.4, 6.6, "Selio n'accepte jamais\n*en dessous.*"], [6.8, 9.9, "Et l'acheteur\n*ne le voit jamais.*"]],
    t0: 1.0, y: 700, rows: [["Calculé depuis ton coût"], ["Et ta marge minimale"], ["Ton plancher saisi à la main prime"]] }),
  END(APPLI, 3),
]) });

reg("31-ta-marge", { formats: V, build: () => seq([
  typo({ dur: 10, chip: "Analyses", caps: [[0.3, 3.4, "Ta marge,\n*formule affichée.*"], [3.6, 6.8, "Calculée en\n*centimes entiers.*"], [7.0, 9.9, "Depuis tes\n*données réelles.*"]],
    t0: 0.9, step: 0.55, y: 620, rows: [["Prix de vente"], ["− frais vendeur", true], ["− port à ta charge", true], ["− prix d'achat et frais d'acquisition", true]],
    extra: `<div class="crow"${an(3.4, "slam", 0.45, "top:1310px;border-color:rgba(226,198,124,.7);color:#F3E2B3;font-size:54px;justify-content:center")}>= Marge brute</div>${sfx("kaching", 3.4)}` }),
  END(undefined, 5),
]) });

reg("32-cout-reel", { formats: V, build: () => seq([
  demo({ dur: 10.4, chip: "Selio Radar", page: "deal", scroll: [[0.9, 300, 1.1]],
    caps: [[0.3, 4.0, "Prix, port,\nprotection acheteurs :"], [4.2, 7.3, "le *vrai coût*\nde ton achat."], [7.5, 10.3, "C'est lui qui sert au\n*calcul de ta marge.*", { fs: 78 }]],
    ov: hl(2.0, 20, 884, 560, 42, 4.2) + hl(2.6, 20, 930, 560, 42, 4.2) + hl(3.2, 20, 976, 560, 42, 4.2) + hl(4.3, 20, 1022, 560, 46),
    extra: fchip(4.6, 7.3, 770, 1700, "Total à payer", "7,80 €", "coin", true) }),
  END(undefined, 1),
]) });

reg("33-plusieurs-comptes", { formats: V, build: () => seq([
  { dur: 10, html: `${chip("Comptes Vinted")}${caps([[0.3, 3.2, "Plusieurs comptes\nVinted ? *Oui.*"], [3.4, 6.6, "Chacun a\n*sa catégorie.*"], [6.8, 9.9, "1, 3 ou 10 comptes,\n*selon ton offre.*"]])}
      ${plan(3.6, 580, "Vente", "Tes boutiques", "annonces, messages, commandes")}${plan(4.1, 880, "Achat", "Ton sourcing", "le Radar lit depuis ce compte", true)}${plan(4.6, 1180, "Perso", "Ton compte à toi", "jamais concerné par les automatisations")}` },
  END(APPLI, 4),
]) });

reg("34-importe-ton-stock", { formats: V, build: () => seq([
  typo({ dur: 10, chip: "Articles et stock", caps: [[0.3, 3.2, "Ton stock est déjà\n*dans un tableur ?*"], [3.4, 6.6, "Importe-le\n*en CSV.*"], [6.8, 9.9, "Rien n'est enregistré\n*avant ta confirmation.*", { fs: 80 }]],
    t0: 3.8, y: 700, rows: [["Un modèle à télécharger"], ["Chaque ligne vérifiée"], ["Export CSV disponible aussi"]] }),
  END(undefined, 6),
]) });

reg("35-changer-d-outil", { formats: V, build: () => seq([
  typo({ dur: 10.4, chip: "Migration", caps: [[0.3, 3.2, "Tu viens d'un\n*autre outil ?*"], [3.4, 6.8, "Reprends\n*tes réglages,*"], [7.0, 10.3, "sans jamais donner\n*tes identifiants.*"]],
    t0: 3.8, y: 700, rows: [["Du texte collé"], ["Des captures d'écran"], ["Ton fichier de portabilité RGPD"]],
    extra: crow(7.4, 1260, "Tu valides champ par champ") }),
  END(APPLI, 0),
]) });

reg("36-sur-ton-telephone", { formats: V, build: () => seq([
  demo({ dur: 9.8, chip: "Mobile", page: "studio", scroll: [[6.3, 560, 1.3]],
    caps: [[0.3, 3.0, "Selio, sur ton\n*écran d'accueil.*"], [3.2, 6.1, "Mode clair\n*ou sombre.*"], [6.3, 9.7, "Tes photos, direct\n*depuis le téléphone.*", { fs: 80 }]],
    ov: hl(7.8, 66, 862, 470, 262),
    extra: `<div style="position:absolute;left:420px;top:1010px;z-index:20"><div${an(3.0, "out", 0.25)}><div${an(0.9, "drop", 0.6)}><img src="${BRAND}selio-app-icon-noir.png" style="display:block;width:240px;height:240px;border-radius:56px;box-shadow:0 0 0 5px rgba(255,255,255,.85),0 40px 90px rgba(0,0,0,.6)"><div style="text-align:center;font:600 40px Inter;margin-top:16px">Selio</div></div></div></div>${sfx("pop", 0.9, 4)}` + fchip(8.1, 9.7, 770, 1700, "Photos", "prises au téléphone", "cam", true) }),
  END(undefined, 2),
]) });

reg("37-stock-automatique", { formats: V, build: () => seq([
  demo({ dur: 10, chip: "Automatisation", page: "vpublished", hd: 208,
    caps: [[0.3, 3.0, "Un article\n*se vend ?*"], [3.2, 6.6, "Selio le remet en ligne,"], [6.8, 9.9, "tant qu'il t'en reste\n*en stock.*"]],
    ov: hl(3.6, 14, 806, 130, 44),
    extra: fchip(1.0, 3.0, 780, 1640, "Vendu", "l'annonce disparaît", "coin", true) + fchip(3.8, 6.6, 300, 1700, "Remise en ligne", "annonce identique", "spark") + fchip(7.2, 9.9, 770, 1700, "Désactivé par défaut", "tu choisis les comptes", "shield") }),
  END(APPLI, 4),
]) });

reg("38-apres-la-vente", { formats: V, build: () => seq([
  demo({ dur: 10.4, chip: "Après-vente", page: "orders", scroll: [[0.9, 330, 1.3]],
    caps: [[0.3, 3.0, "*Vendu.*\nEt après ?"], [3.2, 6.6, "Le bordereau est\n*prêt à l'avance,*"], [6.8, 10.3, "le remerciement et\nla relance *sont préparés.*", { fs: 78 }]],
    ov: hl(3.6, 20, 668, 560, 70),
    extra: fchip(3.9, 6.6, 770, 1690, "Bordereau", "commandé dès la vente", "box", true) + fchip(7.2, 8.7, 300, 1700, "Message", "remerciement", "msg") + fchip(8.8, 10.3, 770, 1700, "Relance", "au point relais", "clock") }),
  END(undefined, 4),
]) });

reg("39-messagerie", { formats: V, build: () => seq([
  demo({ dur: 10.2, chip: "Messagerie", page: "nego",
    caps: [[0.3, 3.1, "Chaque message rattaché\n*au client et à l'article.*", { fs: 76 }], [3.3, 6.5, "L'assistant propose\n*une réponse,*"], [6.7, 10.1, "*tu valides.*", { slam: true, fs: 130 }]],
    ov: hl(1.0, 12, 266, 576, 82, 3.1)
      + `<div${an(7.0, "out", 0.2, "position:absolute;left:60px;top:612px;width:516px")}><div class="sug"${an(3.7, "up", 0.45)}><b>Suggestion de l'IA</b>Bonjour Léa, merci pour ton offre ! Je peux te le laisser à 12,50 €, envoi dès demain.</div></div>${sfx("swish", 3.7)}`
      + `<div class="ov msgbox"${an(7.1, "pop", 0.4, "left:24px;top:612px;width:552px")}><div class="msg">Bonjour Léa, merci pour ton offre ! Je peux te le laisser à 12,50 €, envoi dès demain.<span class="t">Envoyé · 20:04</span></div></div>` + tapS(6.9, 500, 690),
    extra: fchip(4.2, 6.5, 770, 1690, "Brouillon", "relu avant l'envoi", "msg") + fchip(7.4, 10.1, 540, 1700, "Envoyé", "par toi", "check", true) }),
  END(APPLI, 3),
]) });
