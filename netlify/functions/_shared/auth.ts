import { randomUUID, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { supabaseAdmin } from "./supabase";

const scrypt = promisify(scryptCb);
const SESSION_COOKIE = "selio_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export type SafeUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export function toSafeUser(row: {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_key: string | null;
  created_at: string;
}): SafeUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_key ? `/api/media/${row.avatar_key}` : null,
    createdAt: row.created_at,
  };
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function sessionCookieHeader(sessionId: string): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.CONTEXT !== "dev" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.CONTEXT !== "dev" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function createSession(userId: string): Promise<string> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin().from("sessions").insert({ id, user_id: userId, expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  await supabaseAdmin().from("sessions").delete().eq("id", sessionId);
}

export function getSessionIdFromRequest(request: Request): string | null {
  return parseCookies(request)[SESSION_COOKIE] ?? null;
}

export async function getCurrentUser(request: Request): Promise<SafeUser | null> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;

  const { data: session } = await supabaseAdmin()
    .from("sessions")
    .select("user_id, expires_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const { data: user } = await supabaseAdmin().from("users").select("*").eq("id", session.user_id).maybeSingle();
  if (!user) return null;
  return toSafeUser(user as never);
}

export async function requireUser(
  request: Request,
): Promise<{ ok: true; user: SafeUser } | { ok: false; response: Response }> {
  const user = await getCurrentUser(request);
  if (!user) {
    return { ok: false, response: json({ ok: false, error: "unauthorized" }, 401) };
  }
  return { ok: true, user };
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}
