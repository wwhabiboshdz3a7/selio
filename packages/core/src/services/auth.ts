import { z } from "zod";
import { TRIAL_PLAN, loginInput, registerInput, orgSettings, quotasForPlan } from "@selio/contracts";
import { repos, hashPassword, verifyPassword, newSecret, hashSecret, DbError, type Tx } from "@selio/db";
import { passwordResetEmail } from "@selio/email";
import { AppError, sendEmail, webLink, type EmailOutcome, type Services } from "../context";

const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

/** Durées de vie des jetons envoyés par email (usage unique, empreinte SHA-256 seule en base). */
export const PASSWORD_RESET_TTL_MINUTES = 60;
export const INVITE_TTL_DAYS = 7;
/** Jeton brut : 32 octets aléatoires en base64url (43 caractères), jamais stocké ni journalisé. */
export const TOKEN_BYTES = 32;

const tokenField = z.string().trim().min(16).max(256);
const passwordField = z.string().min(10).max(200);
const forgotInput = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
const resetInput = z.object({ token: tokenField, password: passwordField });
const acceptInviteInput = z.object({ token: tokenField, password: passwordField, displayName: z.string().trim().min(1).max(80).optional() });

export interface SessionInfo {
  sessionId: string;
  userId: string;
  orgId: string | null;
}

export function slugify(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base.length >= 2 ? base : "org";
}

export async function register(services: Services, raw: unknown, meta: { ip: string | null; userAgent: string | null; operatorEmails: string[] }): Promise<SessionInfo> {
  const parsed = registerInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Inscription invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  const { hash, salt } = await hashPassword(input.password);
  const info = await services.db.withGlobal(async (tx) => {
    if (await repos.users.byEmail(tx, input.email)) throw new AppError("conflict", "Un compte existe déjà avec cet email.", 409);
    const isOperator = meta.operatorEmails.includes(input.email.toLowerCase());
    const user = await repos.users.create(tx, { email: input.email, displayName: input.displayName, passwordHash: hash, passwordSalt: salt, isOperator });
    let slug = slugify(input.orgName);
    if (await repos.orgs.slugExists(tx, slug)) slug = `${slug}-${newSecret(4).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
    const org = await repos.orgs.create(tx, { name: input.orgName, slug, settings: orgSettings.parse({ onboarding: { completedSteps: ["account"] } }) });
    await repos.memberships.create(tx, { orgId: org.id, userId: user.id, role: "owner" });
    const sessionId = newSecret(32);
    await repos.sessions.create(tx, { id: sessionId, userId: user.id, orgId: org.id, expiresAt: expiry(services), ip: meta.ip, userAgent: meta.userAgent });
    await tx.query("select set_config('app.org_id', $1, true)", [org.id]);
    await repos.audit.add(tx, { orgId: org.id, actorUserId: user.id, action: "auth.register", ip: meta.ip, meta: { trialDays: input.trialDays } });
    return { sessionId, userId: user.id, orgId: org.id };
  });
  // Essai gratuit de 14 jours : toutes les fonctions (et limites) du plan Pro. La carte est demandée
  // dès le début et enregistrée par le parcours de paiement (Revolut, semaine 2) : tant qu'il n'est
  // pas branché, `cardOnFile` reste faux et la fin d'essai n'est pas appliquée. Rien n'est débité
  // avant la fin de l'essai.
  await services.db.withOrg(info.orgId, (tx) => repos.subscriptions.upsert(tx, {
    plan: TRIAL_PLAN,
    status: "trialing",
    provider: "none",
    quotas: quotasForPlan(TRIAL_PLAN),
    currentPeriodEnd: new Date(services.now().getTime() + input.trialDays * 86_400_000).toISOString(),
    cardOnFile: false,
    cancelAtPeriodEnd: false,
    testMode: true,
  }));
  return info;
}

export async function login(services: Services, raw: unknown, meta: { ip: string | null; userAgent: string | null }): Promise<SessionInfo> {
  const parsed = loginInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Identifiants invalides", 400);
  const { email, password } = parsed.data;
  const key = `login:${meta.ip ?? "?"}:${email}`;
  const attempts = await services.db.withGlobal((tx) => repos.rateLimits.hit(tx, key, LOGIN_WINDOW_MS));
  if (attempts > LOGIN_MAX_ATTEMPTS) throw new AppError("rate_limited", "Trop de tentatives, réessayez dans quelques minutes.", 429);
  const user = await services.db.withGlobal((tx) => repos.users.byEmail(tx, email));
  const ok = user ? await verifyPassword(password, user.passwordHash, user.passwordSalt) : (await hashPassword(password), false);
  if (!user || !ok) throw new AppError("unauthorized", "Email ou mot de passe incorrect.", 401);
  return services.db.withGlobal(async (tx) => {
    const memberships = await repos.memberships.forUser(tx, user.id);
    const orgId = memberships[0]?.orgId ?? null;
    const sessionId = newSecret(32);
    await repos.sessions.create(tx, { id: sessionId, userId: user.id, orgId, expiresAt: expiry(services), ip: meta.ip, userAgent: meta.userAgent });
    if (orgId) {
      await tx.query("select set_config('app.org_id', $1, true)", [orgId]);
      await repos.audit.add(tx, { orgId, actorUserId: user.id, action: "auth.login", ip: meta.ip });
    }
    return { sessionId, userId: user.id, orgId };
  });
}

export async function logout(services: Services, sessionId: string): Promise<void> {
  await services.db.withGlobal((tx) => repos.sessions.delete(tx, sessionId));
}

export async function resolveSession(services: Services, sessionId: string): Promise<SessionInfo | null> {
  return services.db.withGlobal(async (tx) => {
    const s = await repos.sessions.get(tx, sessionId);
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < services.now().getTime()) {
      await repos.sessions.delete(tx, sessionId);
      return null;
    }
    // Expiration glissante, rafraîchie au plus une fois par heure.
    if (services.now().getTime() - new Date(s.lastSeenAt).getTime() > 3_600_000) await repos.sessions.touch(tx, sessionId, expiry(services));
    return { sessionId, userId: s.userId, orgId: s.orgId };
  });
}

export async function switchOrg(services: Services, session: SessionInfo, orgId: string): Promise<SessionInfo> {
  return services.db.withGlobal(async (tx) => {
    const m = await repos.memberships.get(tx, orgId, session.userId);
    if (!m) throw new AppError("forbidden", "Vous n'êtes pas membre de cette organisation.", 403);
    await repos.sessions.touch(tx, session.sessionId, expiry(services), orgId);
    return { ...session, orgId };
  });
}

export async function changePassword(services: Services, userId: string, raw: { current?: string; next?: string }): Promise<void> {
  if (!raw.next || raw.next.length < 10) throw new AppError("validation", "Le nouveau mot de passe doit faire 10 caractères minimum.", 400);
  await services.db.withGlobal(async (tx) => {
    const user = await repos.users.byId(tx, userId);
    const full = await repos.users.byEmail(tx, user.email);
    if (!full || !(await verifyPassword(raw.current ?? "", full.passwordHash, full.passwordSalt))) throw new AppError("unauthorized", "Mot de passe actuel incorrect.", 401);
    const { hash, salt } = await hashPassword(raw.next!);
    await repos.users.setPassword(tx, userId, hash, salt);
  });
}

function expiry(services: Services): string {
  return new Date(services.now().getTime() + SESSION_DAYS * 86_400_000).toISOString();
}

// ---------------------------------------------------------------- jetons envoyés par email

function tokenInvalid(): AppError {
  return new AppError("token_invalid", "Ce lien n'est plus valable : il est inconnu, expiré ou a déjà servi. Demandez-en un nouveau.", 400);
}

/** Jeton mal formé → `token_invalid` ; mot de passe trop court → `validation` (message lisible par le formulaire). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTokenInput<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  if (fields.has("token")) throw tokenInvalid();
  throw new AppError("validation", fields.has("password") ? "Le mot de passe doit faire 10 caractères minimum." : "Requête invalide", 400, parsed.error.flatten());
}

/** Journalise une action faite hors contexte de requête : dans la première organisation de l'utilisateur (l'audit est par organisation). */
async function auditUser(tx: Tx, userId: string, e: { action: string; ip: string | null; meta?: Record<string, unknown> }): Promise<void> {
  const orgId = (await repos.memberships.forUser(tx, userId))[0]?.orgId;
  if (!orgId) return;
  await tx.query("select set_config('app.org_id', $1, true)", [orgId]);
  await repos.audit.add(tx, { orgId, actorUserId: userId, action: e.action, meta: e.meta, ip: e.ip });
}

/**
 * Délai minimal de réponse de « mot de passe oublié » (ms). La branche « compte connu » écrit
 * (invalidation, jeton, audit) et la branche « inconnu » ne fait qu'une lecture : sans ce plancher,
 * le temps de réponse trahirait l'existence du compte. L'envoi de l'email, lui, n'est pas attendu.
 */
export const FORGOT_MIN_RESPONSE_MS = 300;

export interface PasswordResetRequest {
  /**
   * Envoi en cours, hors du chemin de la réponse (la route répond sans l'attendre ; elle ne fait que
   * journaliser son issue). `null` quand aucun compte ne porte l'adresse : rien n'est envoyé. Ne rejette jamais.
   */
  delivery: Promise<EmailOutcome> | null;
}

/**
 * Mot de passe oublié. Ne révèle jamais si le compte existe : la route répond 204 dans tous les
 * cas, dans le même temps (délai plancher), et l'email part hors du chemin de la réponse — un
 * aller-retour SMTP (connexion, TLS, AUTH, DATA : de 100 ms à 2 s) attendu avant le 204 aurait
 * permis d'énumérer les comptes au chronomètre. Toute demande précédente encore ouverte est
 * invalidée : un seul lien valable à la fois.
 */
export async function requestPasswordReset(services: Services, raw: unknown, meta: { ip: string | null; minResponseMs?: number }): Promise<PasswordResetRequest> {
  const parsed = forgotInput.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", "Adresse email invalide.", 400, parsed.error.flatten());
  const started = Date.now();
  const token = newSecret(TOKEN_BYTES);
  const recipient = await services.db.withGlobal(async (tx) => {
    const user = await repos.users.byEmail(tx, parsed.data.email);
    if (!user) return null;
    const now = services.now();
    await repos.passwordResets.invalidateForUser(tx, user.id, now.toISOString());
    await repos.passwordResets.create(tx, { userId: user.id, tokenHash: hashSecret(token), expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000).toISOString() });
    await auditUser(tx, user.id, { action: "auth.password_reset_requested", ip: meta.ip });
    return user.email;
  });
  let delivery: Promise<EmailOutcome> | null = null;
  if (recipient) {
    const rendered = passwordResetEmail({ link: webLink(services, "/mot-de-passe", { token }), expiresInMinutes: PASSWORD_RESET_TTL_MINUTES });
    // Démarré ici, jamais attendu ici : `sendEmail` ne lève pas, l'appelant journalise l'issue.
    delivery = sendEmail(services, { to: recipient, ...rendered });
  }
  await padResponse(started, meta.minResponseMs ?? FORGOT_MIN_RESPONSE_MS);
  return { delivery };
}

/** Attend jusqu'à ce que `minMs` se soient écoulés depuis `started` (temps de réponse constant). */
async function padResponse(started: number, minMs: number): Promise<void> {
  const remaining = minMs - (Date.now() - started);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

/** Nouveau mot de passe depuis un lien : jeton à usage unique, toutes les sessions ouvertes sont fermées. */
export async function resetPassword(services: Services, raw: unknown, meta: { ip: string | null }): Promise<void> {
  const input = parseTokenInput(resetInput, raw);
  await services.db.withGlobal(async (tx) => {
    const now = services.now().toISOString();
    const reset = await repos.passwordResets.findValid(tx, hashSecret(input.token), now);
    if (!reset) throw tokenInvalid();
    const { hash, salt } = await hashPassword(input.password);
    await repos.users.setPassword(tx, reset.userId, hash, salt);
    await repos.passwordResets.markUsed(tx, reset.id, now);
    await repos.passwordResets.invalidateForUser(tx, reset.userId, now);
    // Si le mot de passe avait fuité, l'intrus est déconnecté partout.
    await repos.sessions.deleteForUser(tx, reset.userId);
    await auditUser(tx, reset.userId, { action: "auth.password_reset", ip: meta.ip });
  });
}

/**
 * Acceptation d'une invitation : définit le mot de passe (et le nom affiché), consomme
 * le jeton et ouvre une session dans l'organisation — même réponse que la connexion.
 */
export async function acceptInvite(services: Services, raw: unknown, meta: { ip: string | null; userAgent: string | null }): Promise<SessionInfo> {
  const input = parseTokenInput(acceptInviteInput, raw);
  return services.db.withGlobal(async (tx) => {
    const now = services.now().toISOString();
    const invite = await repos.invites.findValid(tx, hashSecret(input.token), now);
    if (!invite) throw tokenInvalid();
    // Le membre a pu être retiré entre l'invitation et l'acceptation : le lien ne vaut plus rien.
    const m = await repos.memberships.get(tx, invite.orgId, invite.userId);
    if (!m) throw tokenInvalid();
    const { hash, salt } = await hashPassword(input.password);
    await repos.users.setPassword(tx, invite.userId, hash, salt);
    if (input.displayName) await repos.users.updateProfile(tx, invite.userId, { displayName: input.displayName });
    await repos.invites.markAccepted(tx, invite.id, now);
    await repos.invites.invalidateForUser(tx, invite.orgId, invite.userId, now);
    await repos.passwordResets.invalidateForUser(tx, invite.userId, now);
    await repos.sessions.deleteForUser(tx, invite.userId);
    const sessionId = newSecret(32);
    await repos.sessions.create(tx, { id: sessionId, userId: invite.userId, orgId: invite.orgId, expiresAt: expiry(services), ip: meta.ip, userAgent: meta.userAgent });
    await tx.query("select set_config('app.org_id', $1, true)", [invite.orgId]);
    await repos.audit.add(tx, { orgId: invite.orgId, actorUserId: invite.userId, action: "member.invite_accepted", targetType: "membership", targetId: m.id, ip: meta.ip });
    return { sessionId, userId: invite.userId, orgId: invite.orgId };
  });
}

export function mapDbError(err: unknown): never {
  if (err instanceof DbError) throw new AppError(err.code === "not_found" ? "not_found" : err.code === "conflict" ? "conflict" : err.code === "validation" ? "validation" : "internal", err.message, err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : err.code === "validation" ? 400 : 500);
  throw err;
}
