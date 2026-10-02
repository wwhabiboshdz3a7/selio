import type { Config } from "@netlify/functions";
import { supabaseAdmin, publicStorageUrl } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { favoriteToggleSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const { data: favs } = await db
      .from("favorites")
      .select("listing_id, created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    const ids = (favs ?? []).map((f) => f.listing_id);
    if (ids.length === 0) return json({ ok: true, items: [] });

    const { data: listings } = await db
      .from("listings")
      .select("*, users!listings_seller_id_fkey(username, display_name)")
      .in("id", ids);

    const { data: images } = await db
      .from("listing_images")
      .select("listing_id, storage_path, position")
      .in("listing_id", ids)
      .order("position", { ascending: true });

    const covers = new Map<string, string>();
    for (const img of images ?? []) if (!covers.has(img.listing_id)) covers.set(img.listing_id, img.storage_path);

    const byId = new Map((listings ?? []).map((l) => [l.id, l]));
    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((l) => {
        const row = l as NonNullable<typeof l>;
        const seller = row.users as { username: string; display_name: string } | null;
        return {
          id: row.id,
          title: row.title,
          priceCents: row.price_cents,
          category: row.category,
          condition: row.condition,
          status: row.status,
          createdAt: row.created_at,
          seller: { username: seller?.username ?? "", displayName: seller?.display_name ?? "" },
          coverImageUrl: covers.has(row.id) ? publicStorageUrl(covers.get(row.id)!) : null,
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
    const parsed = favoriteToggleSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { listingId } = parsed.data;

    const { data: existing } = await db
      .from("favorites")
      .select("user_id")
      .eq("user_id", auth.user.id)
      .eq("listing_id", listingId)
      .maybeSingle();

    const { data: listing } = await db.from("listings").select("favorites_count").eq("id", listingId).maybeSingle();
    const currentCount = listing?.favorites_count ?? 0;

    if (existing) {
      await db.from("favorites").delete().eq("user_id", auth.user.id).eq("listing_id", listingId);
      await db.from("listings").update({ favorites_count: Math.max(currentCount - 1, 0) }).eq("id", listingId);
      return json({ ok: true, favorited: false });
    }

    await db.from("favorites").insert({ user_id: auth.user.id, listing_id: listingId });
    await db.from("listings").update({ favorites_count: currentCount + 1 }).eq("id", listingId);
    return json({ ok: true, favorited: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/favorites" };
