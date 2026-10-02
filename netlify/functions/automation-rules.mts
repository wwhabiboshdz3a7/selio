import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { automationRuleSchema, automationRuleUpdateSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (request.method === "GET") {
    const { data } = await db
      .from("automation_rules")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true });
    const { data: log } = await db
      .from("automation_log")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    return json({ ok: true, rules: data ?? [], log: log ?? [] });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = automationRuleSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { data, error } = await db
      .from("automation_rules")
      .insert({ user_id: auth.user.id, type: parsed.data.type, enabled: parsed.data.enabled, config: parsed.data.config })
      .select("*")
      .single();
    if (error) return json({ ok: false, error: "insert_failed" }, 500);
    return json({ ok: true, rule: data }, 201);
  }

  if (request.method === "PATCH") {
    if (!id) return json({ ok: false, error: "missing_id" }, 400);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = automationRuleUpdateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.config !== undefined) patch.config = parsed.data.config;
    await db.from("automation_rules").update(patch).eq("id", id).eq("user_id", auth.user.id);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    if (!id) return json({ ok: false, error: "missing_id" }, 400);
    await db.from("automation_rules").delete().eq("id", id).eq("user_id", auth.user.id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/pro/automation/rules" };
