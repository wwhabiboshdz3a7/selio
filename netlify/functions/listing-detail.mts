import type { Config, Context } from "@netlify/functions";
import { supabaseAdmin, publicStorageUrl } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { listingUpdateSchema } from "../../src/lib/validation";

export default async (request: Request, context: Context): Promise<Response> => {
  const id = context.params.id;
  if (!id) return json({ ok: false, error: "missing_id" }, 400);
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const { data: listing, error } = await db
      .from("listings")
      .select("*, users!listings_seller_id_fkey(username, display_name, bio, created_at)")
      .eq("id", id)
      .maybeSingle();

    if (error || !listing) return json({ ok: false, error: "not_found" }, 404);

    const { data: images } = await db
      .from("listing_images")
      .select("storage_path, position")
      .eq("listing_id", id)
      .order("position", { ascending: true });

    await db
      .from("listings")
      .update({ views_count: (listing.views_count as number) + 1 })
      .eq("id", id);

    const seller = listing.users as { username: string; display_name: string; bio: string | null; created_at: string } | null;

    return json({
      ok: true,
      listing: {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        priceCents: listing.price_cents,
        category: listing.category,
        size: listing.size,
        condition: listing.condition,
        status: listing.status,
        viewsCount: (listing.views_count as number) + 1,
        favoritesCount: listing.favorites_count,
        createdAt: listing.created_at,
        sellerId: listing.seller_id,
        seller: {
          username: seller?.username ?? "",
          displayName: seller?.display_name ?? "",
          bio: seller?.bio ?? null,
          memberSince: seller?.created_at ?? listing.created_at,
        },
        images: (images ?? []).map((img) => publicStorageUrl(img.storage_path)),
      },
    });
  }

  if (request.method === "PATCH") {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;

    const { data: existing } = await db.from("listings").select("seller_id").eq("id", id).maybeSingle();
    if (!existing) return json({ ok: false, error: "not_found" }, 404);
    if (existing.seller_id !== auth.user.id) return json({ ok: false, error: "forbidden" }, 403);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = listingUpdateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const map: Record<string, string> = {
      title: "title",
      description: "description",
      priceCents: "price_cents",
      category: "category",
      size: "size",
      condition: "condition",
      status: "status",
    };
    for (const [key, col] of Object.entries(map)) {
      const value = (parsed.data as Record<string, unknown>)[key];
      if (value !== undefined) patch[col] = value;
    }

    const { error } = await db.from("listings").update(patch).eq("id", id);
    if (error) return json({ ok: false, error: "update_failed" }, 500);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;

    const { data: existing } = await db.from("listings").select("seller_id").eq("id", id).maybeSingle();
    if (!existing) return json({ ok: false, error: "not_found" }, 404);
    if (existing.seller_id !== auth.user.id) return json({ ok: false, error: "forbidden" }, 403);

    await db.from("listings").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/listings/:id" };
