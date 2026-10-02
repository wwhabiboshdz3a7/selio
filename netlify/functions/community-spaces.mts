import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { communitySpaceCreateSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const { data: spaces } = await db.from("community_spaces").select("*").order("created_at", { ascending: true });
    const { data: memberships } = await db.from("community_members").select("space_id, role").eq("user_id", auth.user.id);
    const myRoles = new Map((memberships ?? []).map((m) => [m.space_id, m.role]));

    const items = (spaces ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      createdBy: s.created_by,
      createdAt: s.created_at,
      myRole: myRoles.get(s.id) ?? null,
    }));
    return json({ ok: true, items });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = communitySpaceCreateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

    const { data: space, error } = await db
      .from("community_spaces")
      .insert({ name: parsed.data.name, description: parsed.data.description ?? null, created_by: auth.user.id })
      .select("*")
      .single();
    if (error || !space) return json({ ok: false, error: "insert_failed" }, 500);

    await db.from("community_members").insert({ space_id: space.id, user_id: auth.user.id, role: "admin" });
    return json({ ok: true, space }, 201);
  }

  if (request.method === "PUT") {
    // Rejoindre un espace existant
    const url = new URL(request.url);
    const spaceId = url.searchParams.get("id");
    if (!spaceId) return json({ ok: false, error: "missing_id" }, 400);
    await db.from("community_members").upsert({ space_id: spaceId, user_id: auth.user.id, role: "member" }, { onConflict: "space_id,user_id" });
    return json({ ok: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/pro/community/spaces" };
