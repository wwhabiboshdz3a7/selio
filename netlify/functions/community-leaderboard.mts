import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  const { data: sales } = await db.from("sales").select("seller_id, sale_price_cents");
  const byUser = new Map<string, { count: number; total: number }>();
  for (const s of sales ?? []) {
    const cur = byUser.get(s.seller_id) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += s.sale_price_cents;
    byUser.set(s.seller_id, cur);
  }

  const ids = [...byUser.keys()];
  const { data: users } = ids.length ? await db.from("users").select("id, username, display_name").in("id", ids) : { data: [] };
  const nameById = new Map((users ?? []).map((u) => [u.id, u]));

  const items = ids
    .map((id) => {
      const stats = byUser.get(id)!;
      const user = nameById.get(id);
      return {
        username: user?.username ?? "?",
        displayName: user?.display_name ?? "?",
        salesCount: stats.count,
        totalRevenueCents: stats.total,
      };
    })
    .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents)
    .slice(0, 20);

  return json({ ok: true, items, me: auth.user.username });
};

export const config: Config = { path: "/api/pro/community/leaderboard" };
