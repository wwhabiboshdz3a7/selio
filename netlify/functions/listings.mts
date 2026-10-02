import type { Config } from "@netlify/functions";
import { supabaseAdmin, publicStorageUrl } from "./_shared/supabase";
import { requireUser, getCurrentUser, json } from "./_shared/auth";
import { listingCreateSchema, CATEGORIES, CONDITIONS } from "../../src/lib/validation";
import { rankScore } from "../../src/lib/ranking";

type ListingRow = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price_cents: number;
  category: string;
  size: string | null;
  condition: string;
  status: string;
  views_count: number;
  favorites_count: number;
  created_at: string;
  users: { username: string; display_name: string } | null;
};

async function attachCovers(db: ReturnType<typeof supabaseAdmin>, listingIds: string[]) {
  if (listingIds.length === 0) return new Map<string, string>();
  const { data } = await db
    .from("listing_images")
    .select("listing_id, storage_path, position")
    .in("listing_id", listingIds)
    .order("position", { ascending: true });
  const covers = new Map<string, string>();
  for (const row of data ?? []) {
    if (!covers.has(row.listing_id)) covers.set(row.listing_id, row.storage_path);
  }
  return covers;
}

function serialize(row: ListingRow, coverPath: string | undefined) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    category: row.category,
    size: row.size,
    condition: row.condition,
    status: row.status,
    viewsCount: row.views_count,
    favoritesCount: row.favorites_count,
    createdAt: row.created_at,
    seller: { username: row.users?.username ?? "", displayName: row.users?.display_name ?? "" },
    coverImageUrl: coverPath ? publicStorageUrl(coverPath) : null,
  };
}

export default async (request: Request): Promise<Response> => {
  const db = supabaseAdmin();

  if (request.method === "GET") {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const category = url.searchParams.get("category") ?? "";
    const size = url.searchParams.get("size") ?? "";
    const condition = url.searchParams.get("condition") ?? "";
    const minPrice = url.searchParams.get("minPrice");
    const maxPrice = url.searchParams.get("maxPrice");
    const sort = url.searchParams.get("sort") ?? "pertinence";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const pageSize = 24;
    const mine = url.searchParams.get("mine") === "1";

    let query = db.from("listings").select("*, users!listings_seller_id_fkey(username, display_name)");

    if (mine) {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) return json({ ok: false, error: "unauthorized" }, 401);
      query = query.eq("seller_id", currentUser.id);
    } else {
      query = query.eq("status", "active");
    }

    if (category && (CATEGORIES as readonly string[]).includes(category)) query = query.eq("category", category);
    if (condition && (CONDITIONS as readonly string[]).includes(condition)) query = query.eq("condition", condition);
    if (size) query = query.eq("size", size);
    if (minPrice) query = query.gte("price_cents", Math.round(Number(minPrice) * 100));
    if (maxPrice) query = query.lte("price_cents", Math.round(Number(maxPrice) * 100));
    if (q) {
      // Les caracteres virgule/parentheses cassent la syntaxe de filtre
      // PostgREST (.or(...)) — on les retire avant de construire le filtre.
      const safeQ = q.replace(/[,()]/g, " ").trim();
      if (safeQ) query = query.or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%`);
    }

    const { data, error } = await query.order("created_at", { ascending: false }).limit(300);
    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = (data ?? []) as unknown as ListingRow[];
    const covers = await attachCovers(db, rows.map((r) => r.id));

    let sorted = rows;
    if (sort === "recent") {
      sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    } else if (sort === "prix_asc") {
      sorted = [...rows].sort((a, b) => a.price_cents - b.price_cents);
    } else if (sort === "prix_desc") {
      sorted = [...rows].sort((a, b) => b.price_cents - a.price_cents);
    } else {
      sorted = [...rows].sort(
        (a, b) =>
          rankScore({ title: b.title, description: b.description, createdAt: b.created_at, favoritesCount: b.favorites_count, viewsCount: b.views_count }, q) -
          rankScore({ title: a.title, description: a.description, createdAt: a.created_at, favoritesCount: a.favorites_count, viewsCount: a.views_count }, q),
      );
    }

    const total = sorted.length;
    const items = sorted.slice((page - 1) * pageSize, page * pageSize).map((r) => serialize(r, covers.get(r.id)));

    return json({ ok: true, items, total, page, pageSize, sort });
  }

  if (request.method === "POST") {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = listingCreateSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid_input", details: parsed.error.flatten() }, 400);
    const data = parsed.data;

    const { data: listing, error } = await db
      .from("listings")
      .insert({
        seller_id: auth.user.id,
        title: data.title,
        description: data.description,
        price_cents: data.priceCents,
        category: data.category,
        size: data.size ?? null,
        condition: data.condition,
      })
      .select("id")
      .single();

    if (error || !listing) return json({ ok: false, error: "insert_failed" }, 500);

    const images = data.imageKeys.map((key, idx) => ({ listing_id: listing.id, storage_path: key, position: idx }));
    const { error: imgError } = await db.from("listing_images").insert(images);
    if (imgError) return json({ ok: false, error: "images_failed" }, 500);

    return json({ ok: true, id: listing.id }, 201);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
};

export const config: Config = { path: "/api/listings" };
