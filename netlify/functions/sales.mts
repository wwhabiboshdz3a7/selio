import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";
import { saleCreateSchema } from "../../src/lib/validation";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const { data } = await db
      .from("sales")
      .select("*")
      .eq("seller_id", auth.user.id)
      .order("sold_at", { ascending: false });
    return json({ ok: true, items: data ?? [] });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = saleCreateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const d = parsed.data;

    const { data, error } = await db
      .from("sales")
      .insert({
        seller_id: auth.user.id,
        listing_id: d.listingId ?? null,
        wardrobe_item_id: d.wardrobeItemId ?? null,
        title: d.title,
        sale_price_cents: d.salePriceCents,
        platform_fee_cents: d.platformFeeCents,
        shipping_cost_cents: d.shippingCostCents,
        purchase_price_cents: d.purchasePriceCents,
        buyer_username: d.buyerUsername ?? null,
        sold_at: d.soldAt ?? new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) return json({ ok: false, error: "insert_failed" }, 500);

    if (d.wardrobeItemId) {
      await db.from("wardrobe_items").update({ status: "sold", updated_at: new Date().toISOString() }).eq("id", d.wardrobeItemId).eq("user_id", auth.user.id);
    }

    return json({ ok: true, sale: data }, 201);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/pro/sales" };
