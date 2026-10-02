import type { Config, Context } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { messageSendSchema } from "../../src/lib/validation";

export default async (request: Request, context: Context): Promise<Response> => {
  const id = context.params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  const { data: conversation } = await db.from("conversations").select("*").eq("id", id).maybeSingle();
  if (!conversation) return json({ ok: false, error: "not_found" }, 404);
  if (conversation.buyer_id !== auth.user.id && conversation.seller_id !== auth.user.id) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (request.method === "GET") {
    const { data: messages } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    await db
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .neq("sender_id", auth.user.id)
      .is("read_at", null);

    const { data: listing } = await db.from("listings").select("id, title").eq("id", conversation.listing_id).maybeSingle();

    return json({
      ok: true,
      listing,
      messages: (messages ?? []).map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        body: m.body,
        createdAt: m.created_at,
        mine: m.sender_id === auth.user.id,
      })),
    });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = messageSendSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

    const { data: message, error } = await db
      .from("messages")
      .insert({ conversation_id: id, sender_id: auth.user.id, body: parsed.data.body })
      .select("id")
      .single();

    if (error || !message) return json({ ok: false, error: "insert_failed" }, 500);
    return json({ ok: true, id: message.id }, 201);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/conversations/:id" };
