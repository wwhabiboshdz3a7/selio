import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { alertEmail, invitationEmail, passwordResetEmail, paymentFailedEmail, escapeHtml } from "./templates";
import { maskEmail } from "./mask";
import { NoopEmailProvider } from "./providers/noop";
import { SMTP_TIMEOUTS_MS, SmtpEmailProvider, smtpTransportOptions, type MailTransport } from "./providers/smtp";
import { createEmailProvider, emailStartupWarnings, loadEmailConfig, DEFAULT_EMAIL_FROM } from "./config";
import type { EmailLogger } from "./types";

function spyLogger() {
  const entries: { level: "info" | "warn"; meta: Record<string, unknown>; msg: string }[] = [];
  const logger: EmailLogger = {
    info: (meta, msg) => void entries.push({ level: "info", meta, msg }),
    warn: (meta, msg) => void entries.push({ level: "warn", meta, msg }),
  };
  return { logger, entries };
}

describe("masquage", () => {
  it("masque la partie locale et garde le domaine", () => {
    expect(maskEmail("ibrahim@exemple.fr")).toBe("i***@exemple.fr");
    expect(maskEmail("a@b.c")).toBe("a***@b.c");
    expect(maskEmail("pas-une-adresse")).toBe("***");
    expect(maskEmail("@exemple.fr")).toBe("***");
    expect(maskEmail("x@")).toBe("***");
  });
});

describe("gabarits", () => {
  const link = "https://app.selio.test/invitation?token=abc_DEF-123";

  it("échappe les données dans le HTML et garde le texte lisible", () => {
    const hostile = `<script>alert(1)</script> & "Boutique" d'Élias`;
    const mail = invitationEmail({ orgName: hostile, inviterName: "<b>Ibrahim</b>", link, expiresInDays: 7 });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Boutique&quot; d&#39;Élias");
    expect(mail.html).toContain("&lt;b&gt;Ibrahim&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Ibrahim</b>");
    // Le texte brut, lui, garde les données telles quelles.
    expect(mail.text).toContain(hostile);
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
    expect(mail.subject).toBe(`Selio — Invitation à rejoindre ${hostile}`);
    expect(mail.text).toContain("7 jours");
    expect(mail.html).not.toMatch(/<img|<script|src=/i);
  });

  it("adapte l'invitation à un compte existant", () => {
    const fresh = invitationEmail({ orgName: "Boutique A", inviterName: "Alice", link, expiresInDays: 7 });
    const existing = invitationEmail({ orgName: "Boutique A", inviterName: "Alice", link, expiresInDays: 7, existingAccount: true });
    expect(fresh.text).toContain("définir votre mot de passe");
    expect(existing.text).toContain("déjà un compte Selio");
  });

  it("mot de passe oublié : lien, durée, avertissement", () => {
    const mail = passwordResetEmail({ link: "https://app.selio.test/mot-de-passe?token=t0k", expiresInMinutes: 60 });
    expect(mail.subject).toBe("Selio — Réinitialisation de votre mot de passe");
    expect(mail.text).toContain("60 minutes");
    expect(mail.text).toContain("https://app.selio.test/mot-de-passe?token=t0k");
    expect(mail.text).toContain("ignorez cet email");
    expect(mail.html).toContain("Choisir un nouveau mot de passe");
  });

  it("échec de paiement et alerte", () => {
    const pay = paymentFailedEmail({ orgName: "Boutique A", planLabel: "Pro", amountLabel: "24,99 €", nextAttemptLabel: "dans 3 jours", link: "https://app.selio.test/app/facturation" });
    expect(pay.subject).toBe("Selio — Échec du paiement de Boutique A");
    expect(pay.text).toContain("Pro (24,99 €)");
    expect(pay.text).toContain("dans 3 jours");
    expect(pay.text).toContain("30 jours");
    const alert = alertEmail({ title: "CAPTCHA rencontré", body: "Le compte <Vente> est en pause.\n\nReconnectez-vous depuis l'extension.", link: "https://app.selio.test/app" });
    expect(alert.subject).toBe("Selio — CAPTCHA rencontré");
    expect(alert.html).toContain("&lt;Vente&gt;");
    expect(alert.html).not.toContain("<Vente>");
    expect((alert.html ?? "").match(/<p style="margin:0 0 14px;font-size:16px/g)?.length).toBe(2);
    expect(alertEmail({ title: "Sans lien", body: "Texte" }).html).not.toContain("<a ");
  });

  it("refuse un lien qui n'est pas une URL http(s)", () => {
    expect(() => passwordResetEmail({ link: "javascript:alert(1)", expiresInMinutes: 60 })).toThrow(/http/);
    expect(() => alertEmail({ title: "x", body: "y", link: "/relatif" })).toThrow();
    expect(escapeHtml(`<a href="x">`)).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
});

describe("fournisseur noop", () => {
  it("journalise l'adresse masquée, jamais le contenu, et garde les derniers messages", async () => {
    const { logger, entries } = spyLogger();
    const p = new NoopEmailProvider({ logger, keepLast: 2 });
    const secretLink = "https://app.selio.test/mot-de-passe?token=SECRET-TOKEN";
    const r = await p.send({ to: "bob@exemple.fr", subject: "Sujet", text: `Lien : ${secretLink}`, html: `<a href="${secretLink}">x</a>` });
    expect(r.id).toMatch(/^noop-/);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.meta.to).toBe("b***@exemple.fr");
    expect(JSON.stringify(entries[0])).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(entries[0])).not.toContain("bob@");
    expect(p.last()?.text).toContain("SECRET-TOKEN");
    await p.send({ to: "c@exemple.fr", subject: "2", text: "deux" });
    await p.send({ to: "d@exemple.fr", subject: "3", text: "trois" });
    expect(p.all().map((m) => m.subject)).toEqual(["2", "3"]);
    p.clear();
    expect(p.last()).toBeNull();
    const silent = new NoopEmailProvider({ keepLast: 0 });
    await silent.send({ to: "e@exemple.fr", subject: "x", text: "y" });
    expect(silent.last()).toBeNull();
  });
});

describe("fournisseur smtp", () => {
  it("transmet from/to/sujet/texte/html au transport et renvoie l'identifiant", async () => {
    const calls: unknown[] = [];
    const transport: MailTransport = { sendMail: async (m) => (calls.push(m), { messageId: "<id-1@smtp>" }), verify: async () => true, close: () => {} };
    const { logger, entries } = spyLogger();
    const p = new SmtpEmailProvider({ from: "Selio <no-reply@selio.test>", transport, logger });
    const r = await p.send({ to: "bob@exemple.fr", subject: "Sujet", text: "corps", html: "<p>corps</p>" });
    expect(r.id).toBe("<id-1@smtp>");
    expect(calls[0]).toEqual({ from: "Selio <no-reply@selio.test>", to: "bob@exemple.fr", subject: "Sujet", text: "corps", html: "<p>corps</p>" });
    expect(entries[0]!.meta.to).toBe("b***@exemple.fr");
    expect(JSON.stringify(entries)).not.toContain("corps");
  });

  it("smtp:// impose STARTTLS (pas de repli en clair), smtps:// chiffre dès la connexion, délais courts, identifiants décodés", () => {
    const starttls = smtpTransportOptions("smtp://utilisateur:mot%40de%3Apasse@smtp.exemple.fr:587");
    expect(starttls).toEqual({ host: "smtp.exemple.fr", port: 587, secure: false, requireTLS: true, auth: { user: "utilisateur", pass: "mot@de:passe" }, connectionTimeout: SMTP_TIMEOUTS_MS.connection, greetingTimeout: SMTP_TIMEOUTS_MS.greeting, socketTimeout: SMTP_TIMEOUTS_MS.socket });
    expect(SMTP_TIMEOUTS_MS.connection).toBeLessThanOrEqual(15_000);
    // Ports par défaut selon le schéma ; sans identifiants, pas d'auth ; TLS direct sans STARTTLS.
    expect(smtpTransportOptions("smtp://smtp.exemple.fr")).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(smtpTransportOptions("smtp://smtp.exemple.fr").auth).toBeUndefined();
    expect(smtpTransportOptions("smtps://u:p@smtp.exemple.fr")).toMatchObject({ host: "smtp.exemple.fr", port: 465, secure: true, requireTLS: false, auth: { user: "u", pass: "p" } });
    expect(() => smtpTransportOptions("http://smtp.exemple.fr")).toThrow(/smtp:\/\//);
    // Le transport réellement construit par nodemailer porte bien requireTLS (l'URL brute ne le donnait pas).
    const transport = nodemailer.createTransport(smtpTransportOptions("smtp://u:p@smtp.exemple.fr:587"));
    expect((transport as unknown as { options: { requireTLS?: boolean; secure?: boolean } }).options).toMatchObject({ requireTLS: true, secure: false });
    expect((nodemailer.createTransport("smtp://u:p@smtp.exemple.fr:587") as unknown as { options: { requireTLS?: boolean } }).options.requireTLS).toBeUndefined();
    transport.close();
  });

  it("remonte l'erreur du serveur en la journalisant sans le destinataire en clair", async () => {
    const transport: MailTransport = { sendMail: async () => { throw new Error("535 Authentication failed"); }, verify: async () => true, close: () => {} };
    const { logger, entries } = spyLogger();
    const p = new SmtpEmailProvider({ from: "x@y.z", transport, logger });
    await expect(p.send({ to: "bob@exemple.fr", subject: "S", text: "t" })).rejects.toThrow(/535/);
    expect(entries[0]!.level).toBe("warn");
    expect(entries[0]!.meta.to).toBe("b***@exemple.fr");
    expect(() => new SmtpEmailProvider({ from: "x@y.z" })).toThrow(/SMTP_URL/);
  });
});

describe("configuration", () => {
  it("noop par défaut, expéditeur par défaut, variables vides tolérées", () => {
    expect(loadEmailConfig({})).toEqual({ provider: "noop", from: DEFAULT_EMAIL_FROM });
    expect(loadEmailConfig({ EMAIL_PROVIDER: "", SMTP_URL: "", EMAIL_FROM: " " })).toEqual({ provider: "noop", from: DEFAULT_EMAIL_FROM });
    expect(loadEmailConfig({ EMAIL_FROM: "Selio <no-reply@selio.fr>" }).from).toBe("Selio <no-reply@selio.fr>");
    expect(() => loadEmailConfig({ EMAIL_PROVIDER: "sendgrid" })).toThrow(/EMAIL_PROVIDER/);
  });

  it("smtp exige une SMTP_URL en smtp:// ou smtps://", () => {
    expect(() => loadEmailConfig({ EMAIL_PROVIDER: "smtp" })).toThrow(/SMTP_URL/);
    expect(() => loadEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_URL: "pas une url" })).toThrow(/URL/);
    expect(() => loadEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_URL: "http://smtp.exemple.fr" })).toThrow(/smtp:\/\//);
    const cfg = loadEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_URL: "smtps://u:p@smtp.exemple.fr:465", EMAIL_FROM: "Selio <no-reply@selio.fr>" });
    expect(cfg).toEqual({ provider: "smtp", from: "Selio <no-reply@selio.fr>", smtpUrl: "smtps://u:p@smtp.exemple.fr:465" });
    // Relecture d'un environnement déjà parsé (valeurs normalisées) : même résultat.
    expect(loadEmailConfig({ EMAIL_PROVIDER: cfg.provider, SMTP_URL: cfg.smtpUrl, EMAIL_FROM: cfg.from })).toEqual(cfg);
  });

  it("avertit en production avec noop, construit le bon fournisseur", () => {
    const noop = loadEmailConfig({});
    expect(emailStartupWarnings(noop, "production")).toHaveLength(1);
    expect(emailStartupWarnings(noop, "production")[0]).toMatch(/noop en production/);
    expect(emailStartupWarnings(noop, "development")).toEqual([]);
    expect(emailStartupWarnings(loadEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_URL: "smtp://smtp.exemple.fr:587" }), "production")).toEqual([]);
    expect(createEmailProvider(noop)).toBeInstanceOf(NoopEmailProvider);
    expect(createEmailProvider({ provider: "smtp", from: "x@y.z", smtpUrl: "smtp://u:p@smtp.exemple.fr:587" })).toBeInstanceOf(SmtpEmailProvider);
  });
});
