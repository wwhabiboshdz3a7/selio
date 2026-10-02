import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { verifyPassword, createSession, sessionCookieHeader, toSafeUser, json } from "./_shared/auth";
import { loginSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

  const db = supabaseAdmin();
  const { data: user } = await db.from("users").select("*").eq("email", parsed.data.email).maybeSingle();
  if (!user) return json({ ok: false, error: "invalid_credentials" }, 401);

  const valid = await verifyPassword(parsed.data.password, user.password_hash, user.password_salt);
  if (!valid) return json({ ok: false, error: "invalid_credentials" }, 401);

  const sessionId = await createSession(user.id);
  return json({ ok: true, user: toSafeUser(user as never) }, 200, { "set-cookie": sessionCookieHeader(sessionId) });
};

export const config: Config = { path: "/api/auth/login" };
