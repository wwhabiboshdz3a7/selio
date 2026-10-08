import { loginInput, registerInput, orgSettings } from "@selio/contracts";
import { repos, hashPassword, verifyPassword, newSecret, DbError } from "@selio/db";
import { AppError, type Services } from "../context";

const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

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
  return services.db.withGlobal(async (tx) => {
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
    await repos.audit.add(tx, { orgId: org.id, actorUserId: user.id, action: "auth.register", ip: meta.ip });
    return { sessionId, userId: user.id, orgId: org.id };
  });
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

export function mapDbError(err: unknown): never {
  if (err instanceof DbError) throw new AppError(err.code === "not_found" ? "not_found" : err.code === "conflict" ? "conflict" : err.code === "validation" ? "validation" : "internal", err.message, err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : err.code === "validation" ? 400 : 500);
  throw err;
}
