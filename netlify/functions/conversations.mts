import type { Config } from "@netlify/functions";
import { supabaseAdmin, publicStorageUrl } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { conversationStartSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const { data: convs } = await db
      .from("conversations")
      .select(
        "id, listing_id, buyer_id, seller_id, created_at, listings(title), buyer:users!conversations_buyer_id_fkey(username, display_name), seller:users!conversations_seller_id_fkey(username, display_name)",
      )
      .or(`buyer_id.eq.${auth.user.id},seller_id.eq.${auth.user.id}`)
      .order("created_at", { ascending: false });

    const list = convs ?? [];
    const listingIds = list.map((c) => c.listing_id);
    const convIds = list.map((c) => c.id);

    const { data: images } = listingIds.length
      ? await db.from("listing_images").select("listing_id, storage_path, position").in("listing_id", listingIds).order("position", { ascending: true })
      : { data: [] as { listing_id: string; storage_path: string; position: number }[] };
    const covers = new Map<string, string>();
    for (const img of images ?? []) if (!covers.has(img.listing_id)) covers.set(img.listing_id, img.storage_path);

    const { data: lastMessages } = convIds.length
      ? await db.from("messages").select("conversation_id, body, created_at").in("conversation_id", convIds).order("created_at", { ascending: false })
      : { data: [] as { conversation_id: string; body: string; created_at: string }[] };
    const lastByConv = new Map<string, { body: string; created_at: string }>();
    for (const m of lastMessages ?? []) if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);

    const items = list.map((c) => {
      const isBuyer = c.buyer_id === auth.user.id;
      const listingRel = c.listings as unknown as { title: string } | { title: string }[] | null;
      const listingTitle = Array.isArray(listingRel) ? listingRel[0]?.title : listingRel?.title;
      const counterpartRel = (isBuyer ? c.seller : c.buyer) as unknown as
        | { username: string; display_name: string }
        | { username: string; display_name: string }[]
        | null;
      const counterpart = Array.isArray(counterpartRel) ? counterpartRel[0] : counterpartRel;
      const last = lastByConv.get(c.id);
      return {
        id: c.id,
        listingId: c.listing_id,
        listingTitle: listingTitle ?? "",
        coverImageUrl: covers.has(c.listing_id) ? publicStorageUrl(covers.get(c.listing_id)!) : null,
        counterpart: { username: counterpart?.username ?? "", displayName: counterpart?.display_name ?? "" },
        lastMessage: last?.body ?? null,
        lastMessageAt: last?.created_at ?? c.created_at,
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
    const parsed = conversationStartSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

    const { data: listing } = await db.from("listings").select("seller_id").eq("id", parsed.data.listingId).maybeSingle();
    if (!listing) return json({ ok: false, error: "listing_not_found" }, 404);
    if (listing.seller_id === auth.user.id) return json({ ok: false, error: "cannot_message_self" }, 400);

    const { data: existingConv } = await db
      .from("conversations")
      .select("id")
      .eq("listing_id", parsed.data.listingId)
      .eq("buyer_id", auth.user.id)
      .maybeSingle();

    let conversationId: string;
    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: created, error } = await db
        .from("conversations")
        .insert({ listing_id: parsed.data.listingId, buyer_id: auth.user.id, seller_id: listing.seller_id })
        .select("id")
        .single();
      if (error || !created) return json({ ok: false, error: "insert_failed" }, 500);
      conversationId = created.id;
    }

    await db.from("messages").insert({ conversation_id: conversationId, sender_id: auth.user.id, body: parsed.data.message });

    return json({ ok: true, conversationId }, 201);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/conversations" };
