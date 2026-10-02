import type { Config } from "@netlify/functions";
import { getCurrentUser, json } from "./_shared/auth";

export default async (request: Request): Promise<Response> => {
  const user = await getCurrentUser(request);
  return json({ ok: true, user }, 200, { "cache-control": "no-store" });
};

export const config: Config = { path: "/api/user" };
