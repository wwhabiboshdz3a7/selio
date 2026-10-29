/**
 * Gabarits des emails transactionnels, en français. Chaque gabarit renvoie le
 * sujet, une version texte et une version HTML simple (styles en ligne, aucune
 * image externe, aucun script). Toute donnée variable est échappée dans le HTML :
 * un nom d'organisation ou un texte d'alerte ne peut pas injecter de balise.
 */
import type { EmailMessage } from "./types";

export type RenderedEmail = Omit<EmailMessage, "to">;

const SUBJECT_PREFIX = "Selio — ";
const FOOTER = "Selio est un outil indépendant, ni affilié, ni approuvé, ni sponsorisé par Vinted.";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Seuls des liens http(s) absolus sont acceptés dans un email (jamais de `javascript:`). */
function assertLink(url: string): string {
  if (!/^https?:\/\/[^\s<>"']+$/i.test(url)) throw new Error("Lien d'email invalide : URL http(s) absolue attendue.");
  return url;
}

interface Layout {
  title: string;
  /** Paragraphes en texte brut (échappés pour le HTML). */
  paragraphs: string[];
  /** Bouton d'action : libellé + lien ; le lien est aussi écrit en clair pour les clients qui bloquent les boutons. */
  cta?: { label: string; url: string };
  /** Note de fin (texte brut), ex. « Si vous n'êtes pas à l'origine de cette demande… ». */
  note?: string;
}

function renderText(l: Layout): string {
  const parts = [l.title, "", ...l.paragraphs.flatMap((p) => [p, ""])];
  if (l.cta) parts.push(`${l.cta.label} : ${l.cta.url}`, "");
  if (l.note) parts.push(l.note, "");
  parts.push("— L'équipe Selio", FOOTER);
  return parts.join("\n").trim() + "\n";
}

function renderHtml(l: Layout): string {
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1f2933">${escapeHtml(s)}</p>`;
  const cta = l.cta
    ? `<p style="margin:22px 0"><a href="${escapeHtml(l.cta.url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1f2933;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(l.cta.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#52606d">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${escapeHtml(l.cta.url)}</span></p>`
    : "";
  const note = l.note ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#52606d">${escapeHtml(l.note)}</p>` : "";
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(l.title)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f5f7fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px">` +
    `<p style="margin:0 0 18px;font-size:14px;font-weight:700;letter-spacing:.04em;color:#52606d">SELIO</p>` +
    `<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#1f2933">${escapeHtml(l.title)}</h1>` +
    l.paragraphs.map(p).join("") +
    cta +
    note +
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#7b8794">${escapeHtml(FOOTER)}</p>` +
    `</div></body></html>`
  );
}

function render(subject: string, layout: Layout): RenderedEmail {
  if (layout.cta) assertLink(layout.cta.url);
  return { subject: SUBJECT_PREFIX + subject, text: renderText(layout), html: renderHtml(layout) };
}

/** Invitation à rejoindre une organisation : le lien mène à la page où l'on définit son mot de passe. */
export function invitationEmail(input: { orgName: string; inviterName: string; link: string; expiresInDays: number; existingAccount?: boolean }): RenderedEmail {
  const paragraphs = [
    `${input.inviterName} vous invite à rejoindre l'espace « ${input.orgName} » sur Selio, la suite d'outils des revendeurs Vinted.`,
    input.existingAccount
      ? "Vous avez déjà un compte Selio avec cette adresse : cliquez sur le bouton pour accepter l'invitation et définir votre mot de passe (l'espace apparaîtra ensuite dans vos organisations)."
      : "Cliquez sur le bouton pour définir votre mot de passe et accéder à l'espace.",
    `Ce lien est valable ${input.expiresInDays} jours et ne sert qu'une fois.`,
  ];
  return render(`Invitation à rejoindre ${input.orgName}`, {
    title: `Vous êtes invité·e à rejoindre ${input.orgName}`,
    paragraphs,
    cta: { label: "Accepter l'invitation", url: input.link },
    note: "Si vous ne connaissez pas cette personne, ignorez simplement cet email : aucun compte ne sera activé sans vous.",
  });
}

/** Mot de passe oublié : lien de réinitialisation, valable une heure, à usage unique. */
export function passwordResetEmail(input: { link: string; expiresInMinutes: number }): RenderedEmail {
  return render("Réinitialisation de votre mot de passe", {
    title: "Réinitialiser votre mot de passe",
    paragraphs: [
      "Vous avez demandé à réinitialiser le mot de passe de votre compte Selio.",
      `Cliquez sur le bouton pour en choisir un nouveau. Le lien est valable ${input.expiresInMinutes} minutes et ne sert qu'une fois ; vos autres sessions seront fermées.`,
    ],
    cta: { label: "Choisir un nouveau mot de passe", url: input.link },
    note: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.",
  });
}

/** Échec de paiement : nouvelle tentative annoncée, lien vers la facturation. Aucun numéro de carte, jamais. */
export function paymentFailedEmail(input: { orgName: string; planLabel: string; amountLabel?: string; nextAttemptLabel?: string; link: string }): RenderedEmail {
  const amount = input.amountLabel ? ` (${input.amountLabel})` : "";
  const paragraphs = [
    `Le paiement de l'abonnement ${input.planLabel}${amount} de « ${input.orgName} » n'a pas abouti.`,
    input.nextAttemptLabel
      ? `Nous réessaierons automatiquement ${input.nextAttemptLabel}. Pour éviter toute interruption, vérifiez votre moyen de paiement dès maintenant.`
      : "Vérifiez votre moyen de paiement pour éviter toute interruption de service.",
    "Après trois échecs, l'espace repasse à l'accès de base ; vos données sont conservées 30 jours.",
  ];
  return render(`Échec du paiement de ${input.orgName}`, {
    title: "Votre paiement n'a pas abouti",
    paragraphs,
    cta: { label: "Mettre à jour mon moyen de paiement", url: input.link },
  });
}

/** Alerte en texte libre (CAPTCHA rencontré, compte en pause, quota atteint…). */
export function alertEmail(input: { title: string; body: string; link?: string; linkLabel?: string }): RenderedEmail {
  const paragraphs = input.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return render(input.title, {
    title: input.title,
    paragraphs: paragraphs.length ? paragraphs : [input.body],
    ...(input.link ? { cta: { label: input.linkLabel ?? "Ouvrir Selio", url: input.link } } : {}),
  });
}
