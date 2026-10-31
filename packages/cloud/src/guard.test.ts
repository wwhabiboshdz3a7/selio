import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCK_MESSAGES, detectBlock, normalizeText, prominentText } from "./guard";

const CONV = "https://www.vinted.fr/inbox/987";
const page = (body: string, title = "Messages – Vinted") => `<!doctype html><html lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;
const fixture = readFileSync(new URL("../../connectors/src/vinted/fixtures/conversation-page.v1.html", import.meta.url), "utf8");

describe("detectBlock — pages normales", () => {
  it("ne signale rien sur la fixture de conversation de l'adaptateur", () => {
    expect(detectBlock(fixture, CONV)).toBeNull();
  });

  it("un script anti-robot chargé sur toutes les pages ne déclenche rien", () => {
    const html = page(`<script src="https://js.datadome.co/tags.js"></script><script>var captcha = "geo.captcha-delivery.com";</script><div class="grecaptcha-badge"></div><iframe src="https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=invisible"></iframe><ul><li>ok</li></ul><form><textarea></textarea></form>`);
    expect(detectBlock(html, CONV)).toBeNull();
  });

  it("le corps d'un message d'acheteur n'est jamais « en évidence »", () => {
    const html = fixture.replace("Je propose 25 €.", "Trop de requêtes, votre compte a été suspendu, captcha !");
    expect(detectBlock(html, CONV)).toBeNull();
  });
});

describe("detectBlock — signaux de Vinted", () => {
  it("CAPTCHA DataDome (cadre visible)", () => {
    const html = page(`<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=abc" title="DataDome CAPTCHA"></iframe>`, "vinted.fr");
    expect(detectBlock(html, CONV)).toEqual({ code: "captcha", message: BLOCK_MESSAGES.captcha, pattern: "captcha.markup.datadome" });
  });

  it("CAPTCHA par l'URL (redirection vers le service de vérification)", () => {
    expect(detectBlock(page(""), "https://geo.captcha-delivery.com/captcha/?x=1")?.code).toBe("captcha");
    expect(detectBlock(page(""), "https://www.vinted.fr/inbox/1?__cf_chl_rt_tk=abc")?.code).toBe("captcha");
  });

  it("reCAPTCHA visible et page d'attente de vérification", () => {
    expect(detectBlock(page(`<iframe src="https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal"></iframe>`), CONV)?.pattern).toBe("captcha.markup.recaptcha");
    expect(detectBlock(page(`<div id="challenge-running"></div>`, "Just a moment..."), CONV)?.code).toBe("captcha");
    expect(detectBlock(page(`<h1>Vérifiez que vous êtes humain</h1>`), CONV)?.code).toBe("captcha");
  });

  it("« Trop de requêtes » (texte ou statut 429)", () => {
    expect(detectBlock(page(`<h1>Trop de requêtes</h1><p>Réessaie dans quelques minutes.</p>`), CONV)).toMatchObject({ code: "rate_limited", pattern: "rate_limited.text" });
    expect(detectBlock("Too Many Requests", CONV)?.code).toBe("rate_limited");
    expect(detectBlock(page("<form><textarea></textarea></form>"), CONV, { status: 429 })).toMatchObject({ code: "rate_limited", pattern: "rate_limited.http429" });
  });

  it("compte suspendu ou accès refusé → blocked", () => {
    expect(detectBlock(page(`<div role="alert">Ton compte a été suspendu suite à une violation des règles.</div><form><textarea></textarea></form>`), CONV)?.code).toBe("blocked");
    expect(detectBlock(page(`<h1>Accès refusé</h1>`), CONV)?.code).toBe("blocked");
    expect(detectBlock(page("<form><textarea></textarea></form>"), CONV, { status: 403 })?.pattern).toBe("blocked.http403");
  });

  it("avertissement sur le compte → warning", () => {
    const html = page(`<div role="dialog" aria-modal="true"><h2>Avertissement</h2><p>Nous avons détecté une activité inhabituelle sur ton compte.</p></div><form><textarea></textarea></form>`);
    expect(detectBlock(html, CONV)).toMatchObject({ code: "warning", message: BLOCK_MESSAGES.warning });
    expect(detectBlock(page(`<h2>Votre compte a été temporairement restreint</h2><form><input></form>`), CONV)?.code).toBe("warning");
  });

  it("page de connexion à la place d'une page de membre → not_logged_in", () => {
    expect(detectBlock(page(`<h1>Bienvenue</h1>`), "https://www.vinted.fr/member/login?ref=/inbox/987")?.pattern).toBe("not_logged_in.url");
    expect(detectBlock(page(`<form><input type="email"><input type="password"></form>`), CONV)?.pattern).toBe("not_logged_in.markup.password");
    expect(detectBlock(page(`<h1>Inscris-toi ou connecte-toi</h1><form><input></form>`), CONV)?.code).toBe("not_logged_in");
  });

  it("la page de connexion n'est pas un signal quand on ne l'attend pas membre", () => {
    expect(detectBlock(page(`<form><input type="password"></form>`), "https://www.vinted.fr/member/login", { expectMember: false })).toBeNull();
  });

  it("un CAPTCHA sur la page de connexion reste un CAPTCHA (priorité)", () => {
    const html = page(`<form><input type="password"></form><iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>`);
    expect(detectBlock(html, "https://www.vinted.fr/member/login")?.code).toBe("captcha");
  });
});

describe("normalisation", () => {
  it("minuscules, sans accents, apostrophes droites, entités décodées", () => {
    expect(normalizeText("Ton compte a été&nbsp;SUSPENDU — l’accès")).toBe("ton compte a ete suspendu — l'acces");
    expect(normalizeText("&#233;t&#xE9; &quot;bloqu&#233;&quot;")).toBe('ete "bloque"');
  });

  it("le texte en évidence comprend titre, titres et zones d'alerte, pas les listes", () => {
    const t = prominentText(page(`<h1>Titre</h1><ul><li>message privé</li></ul><div role="alert">Alerte</div><form><textarea></textarea></form>`, "Page"));
    expect(t).toContain("titre");
    expect(t).toContain("alerte");
    expect(t).toContain("page");
    expect(t).not.toContain("message prive");
  });
});
