import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { hashPassword, createSession, sessionCookieHeader, toSafeUser, json } from "./_shared/auth";
import { registerSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "invalid_input", details: parsed.error.flatten() }, 400);
  const { email, username, displayName, password } = parsed.data;

  const db = supabaseAdmin();
  const { data: existing } = await db.from("users").select("id").or(`email.eq.${email},username.eq.${username}`).maybeSingle();
  if (existing) return json({ ok: false, error: "email_or_username_taken" }, 409);

  const { hash, salt } = await hashPassword(password);
  const { data: inserted, error } = await db
    .from("users")
    .insert({ email, username, display_name: displayName, password_hash: hash, password_salt: salt })
    .select("*")
    .single();

  if (error || !inserted) return json({ ok: false, error: "insert_failed" }, 500);

  const sessionId = await createSession(inserted.id);
  return json({ ok: true, user: toSafeUser(inserted as never) }, 201, { "set-cookie": sessionCookieHeader(sessionId) });
};

export const config: Config = { path: "/api/auth/register" };
