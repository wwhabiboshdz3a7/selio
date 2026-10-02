import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { wardrobeCreateSchema, wardrobeUpdateSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();
  const id = new URL(request.url).searchParams.get("id");

  if (request.method === "GET") {
    const { data } = await db
      .from("wardrobe_items")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });
    return json({ ok: true, items: data ?? [] });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = wardrobeCreateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const d = parsed.data;

    const { data, error } = await db
      .from("wardrobe_items")
      .insert({
        user_id: auth.user.id,
        title: d.title,
        brand: d.brand ?? null,
        purchase_price_cents: d.purchasePriceCents ?? null,
        purchase_date: d.purchaseDate ?? null,
        category: d.category ?? null,
        notes: d.notes ?? null,
        listing_id: d.listingId ?? null,
      })
      .select("*")
      .single();
    if (error) return json({ ok: false, error: "insert_failed" }, 500);
    return json({ ok: true, item: data }, 201);
  }

  if (request.method === "PATCH") {
    if (!id) return json({ ok: false, error: "missing_id" }, 400);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = wardrobeUpdateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const d = parsed.data;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (d.title !== undefined) patch.title = d.title;
    if (d.brand !== undefined) patch.brand = d.brand;
    if (d.purchasePriceCents !== undefined) patch.purchase_price_cents = d.purchasePriceCents;
    if (d.purchaseDate !== undefined) patch.purchase_date = d.purchaseDate;
    if (d.category !== undefined) patch.category = d.category;
    if (d.notes !== undefined) patch.notes = d.notes;
    if (d.listingId !== undefined) patch.listing_id = d.listingId;
    if (d.status !== undefined) patch.status = d.status;

    const { error } = await db.from("wardrobe_items").update(patch).eq("id", id).eq("user_id", auth.user.id);
    if (error) return json({ ok: false, error: "update_failed" }, 500);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    if (!id) return json({ ok: false, error: "missing_id" }, 400);
    await db.from("wardrobe_items").delete().eq("id", id).eq("user_id", auth.user.id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/pro/wardrobe" };
