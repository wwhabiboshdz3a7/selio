import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { communityPostCreateSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const url = new URL(request.url);
    const spaceId = url.searchParams.get("spaceId");
    if (!spaceId) return json({ ok: false, error: "missing_space_id" }, 400);

    const { data: posts } = await db
      .from("community_posts")
      .select("*, users!community_posts_author_id_fkey(username, display_name)")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false });

    const items = (posts ?? []).map((p) => {
      const author = p.users as unknown as { username: string; display_name: string } | { username: string; display_name: string }[] | null;
      const a = Array.isArray(author) ? author[0] : author;
      return {
        id: p.id,
        kind: p.kind,
        title: p.title,
        body: p.body,
        createdAt: p.created_at,
        author: { username: a?.username ?? "", displayName: a?.display_name ?? "" },
      };
    });
    return json({ ok: true, items });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = communityPostCreateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

    const { data: membership } = await db
      .from("community_members")
      .select("role")
      .eq("space_id", parsed.data.spaceId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    // Seul un admin de l'espace peut publier un "doc" officiel ou un "gift" ;
    // un simple membre peut publier une annonce classique.
    if ((parsed.data.kind === "doc" || parsed.data.kind === "gift") && membership?.role !== "admin") {
      return json({ ok: false, error: "forbidden_admin_only" }, 403);
    }
    if (!membership) return json({ ok: false, error: "not_a_member" }, 403);

    const { data: post, error } = await db
      .from("community_posts")
      .insert({ space_id: parsed.data.spaceId, author_id: auth.user.id, kind: parsed.data.kind, title: parsed.data.title, body: parsed.data.body })
      .select("*")
      .single();
    if (error || !post) return json({ ok: false, error: "insert_failed" }, 500);
    return json({ ok: true, post }, 201);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/pro/community/posts" };
