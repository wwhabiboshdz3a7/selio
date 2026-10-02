import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { salesAccountCreateSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const { data } = await db
      .from("sales_accounts")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true });
    return json({ ok: true, items: data ?? [] });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = salesAccountCreateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

    // IMPORTANT : Vinted n'a pas d'API publique pour les vendeurs. Un compte
    // "vinted" cree ici reste donc au statut 'not_connected' — c'est un
    // point d'ancrage pour une future integration, jamais une vraie connexion
    // automatique a Vinted. Voir README pour le detail de cette limite.
    const status = parsed.data.platform === "selio" ? "connected" : "not_connected";

    const { data, error } = await db
      .from("sales_accounts")
      .insert({ user_id: auth.user.id, platform: parsed.data.platform, label: parsed.data.label, status })
      .select("*")
      .single();
    if (error) return json({ ok: false, error: "insert_failed" }, 500);
    return json({ ok: true, account: data }, 201);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ ok: false, error: "missing_id" }, 400);
    await db.from("sales_accounts").delete().eq("id", id).eq("user_id", auth.user.id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/pro/accounts" };
