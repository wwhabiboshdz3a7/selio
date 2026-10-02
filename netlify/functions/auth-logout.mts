import type { Config } from "@netlify/functions";
import { destroySession, getSessionIdFromRequest, clearSessionCookieHeader, json } from "./_shared/auth";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const sessionId = getSessionIdFromRequest(request);
  if (sessionId) await destroySession(sessionId);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookieHeader() });
};

export const config: Config = { path: "/api/auth/logout" };
