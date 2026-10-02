import type { Config } from "@netlify/functions";
import { supabaseAdmin } from "./_shared/supabase";
import { nextShippingDayLabel, renderTemplate, extractOfferCents } from "./_shared/automation-helpers";

// Moteur d'automatisation Selio. Tourne automatiquement toutes les 15 min
// (Netlify Scheduled Functions, gratuit) et agit UNIQUEMENT sur les donnees
// Selio (favoris, messages, annonces de CE site) — il ne touche a aucun
// compte Vinted externe (aucune API publique n'existe pour ca, voir README).
//
// Types de regles geres :
//  - message_on_favorite : message auto a l'utilisateur qui a mis en favori
//  - relance             : relance si le dernier message (du vendeur) reste
//                          sans reponse apres N jours
//  - negotiation         : acceptation/refus auto d'une offre de prix selon
//                          la marge autorisee
//  - post_sale_message   : message auto apres une vente
//  - auto_relist         : republie automatiquement une annonce archivee/vendue

async function log(db: ReturnType<typeof supabaseAdmin>, ruleId: string, userId: string, listingId: string | null, action: string, detail: string) {
  await db.from("automation_log").insert({ rule_id: ruleId, user_id: userId, listing_id: listingId, action, detail });
}

async function ensureConversation(db: ReturnType<typeof supabaseAdmin>, listingId: string, buyerId: string, sellerId: string): Promise<string> {
  const { data: existing } = await db.from("conversations").select("id").eq("listing_id", listingId).eq("buyer_id", buyerId).maybeSingle();
  if (existing) return existing.id;
  const { data: created } = await db
    .from("conversations")
    .insert({ listing_id: listingId, buyer_id: buyerId, seller_id: sellerId })
    .select("id")
    .single();
  return created!.id;
}

export default async (): Promise<Response> => {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // fenetre de 20 min (marge sur le cron de 15 min)

  const { data: rules } = await db.from("automation_rules").select("*").eq("enabled", true);
  let actions = 0;

  for (const rule of rules ?? []) {
    const cfg = (rule.config ?? {}) as Record<string, unknown>;

    // --- message_on_favorite ---
    if (rule.type === "message_on_favorite") {
      const { data: favs } = await db.from("favorites").select("user_id, listing_id, created_at").gte("created_at", since);
      for (const fav of favs ?? []) {
        const { data: listing } = await db.from("listings").select("id, title, seller_id").eq("id", fav.listing_id).maybeSingle();
        if (!listing || listing.seller_id !== rule.user_id) continue;
        if (fav.user_id === rule.user_id) continue;
        const { data: already } = await db
          .from("automation_log")
          .select("id")
          .eq("rule_id", rule.id)
          .eq("listing_id", listing.id)
          .eq("action", "message_on_favorite")
          .ilike("detail", `%${fav.user_id}%`)
          .maybeSingle();
        if (already) continue;

        const template = (cfg.template as string) || "Bonjour ! J'ai vu que vous aviez mis « {{listingTitle}} » en favori, il est toujours disponible 😊 N'hesitez pas si vous avez des questions !";
        const body = renderTemplate(template, { listingTitle: listing.title });
        const convId = await ensureConversation(db, listing.id, fav.user_id, listing.seller_id);
        await db.from("messages").insert({ conversation_id: convId, sender_id: listing.seller_id, body });
        await log(db, rule.id, rule.user_id, listing.id, "message_on_favorite", `buyer:${fav.user_id}`);
        actions++;
      }
    }

    // --- relance ---
    if (rule.type === "relance") {
      const afterDays = Number(cfg.afterDays ?? 2);
      const threshold = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000).toISOString();
      const { data: convs } = await db.from("conversations").select("id, listing_id, buyer_id, seller_id").eq("seller_id", rule.user_id);
      for (const conv of convs ?? []) {
        const { data: lastMsg } = await db
          .from("messages")
          .select("sender_id, created_at")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!lastMsg || lastMsg.sender_id !== conv.seller_id) continue;
        if (lastMsg.created_at > threshold) continue;

        const { data: alreadyRelanced } = await db
          .from("automation_log")
          .select("id, created_at")
          .eq("rule_id", rule.id)
          .eq("listing_id", conv.listing_id)
          .eq("action", "relance")
          .ilike("detail", `%${conv.id}%`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (alreadyRelanced && alreadyRelanced.created_at > threshold) continue;

        const { data: listing } = await db.from("listings").select("title").eq("id", conv.listing_id).maybeSingle();
        const template = (cfg.template as string) || "Petite relance : « {{listingTitle}} » est toujours disponible, ca vous interesse toujours ?";
        const body = renderTemplate(template, { listingTitle: listing?.title ?? "cet article" });
        await db.from("messages").insert({ conversation_id: conv.id, sender_id: conv.seller_id, body });
        await log(db, rule.id, rule.user_id, conv.listing_id, "relance", `conv:${conv.id}`);
        actions++;
      }
    }

    // --- negotiation ---
    if (rule.type === "negotiation") {
      const maxDiscountPercent = Number(cfg.maxDiscountPercent ?? 10);
      const { data: recentMsgs } = await db.from("messages").select("*").gte("created_at", since);
      for (const msg of recentMsgs ?? []) {
        const { data: conv } = await db.from("conversations").select("*").eq("id", msg.conversation_id).maybeSingle();
        if (!conv || conv.seller_id !== rule.user_id) continue;
        if (msg.sender_id !== conv.buyer_id) continue; // seul un message acheteur declenche une negociation

        const { data: already } = await db
          .from("automation_log")
          .select("id")
          .eq("rule_id", rule.id)
          .eq("action", "negotiation")
          .ilike("detail", `%msg:${msg.id}%`)
          .maybeSingle();
        if (already) continue;

        const offerCents = extractOfferCents(msg.body);
        if (offerCents === null) continue;

        const { data: listing } = await db.from("listings").select("id, title, price_cents").eq("id", conv.listing_id).maybeSingle();
        if (!listing) continue;

        const floor = listing.price_cents * (1 - maxDiscountPercent / 100);
        const accepted = offerCents >= floor;
        const body = accepted
          ? `C'est d'accord pour ${(offerCents / 100).toFixed(2)} € ! Je vous laisse confirmer et on organise l'envoi.`
          : `Merci pour votre offre, mais je ne peux pas descendre en dessous de ${(floor / 100).toFixed(2)} € sur « ${listing.title} ». Ca vous irait ?`;

        await db.from("messages").insert({ conversation_id: conv.id, sender_id: conv.seller_id, body });
        await log(db, rule.id, rule.user_id, listing.id, "negotiation", `msg:${msg.id} offer:${offerCents} accepted:${accepted}`);
        actions++;
      }
    }

    // --- post_sale_message ---
    if (rule.type === "post_sale_message") {
      const { data: sales } = await db.from("sales").select("*").eq("seller_id", rule.user_id).gte("created_at", since);
      for (const sale of sales ?? []) {
        if (!sale.listing_id) continue;
        const { data: already } = await db
          .from("automation_log")
          .select("id")
          .eq("rule_id", rule.id)
          .eq("listing_id", sale.listing_id)
          .eq("action", "post_sale_message")
          .maybeSingle();
        if (already) continue;

        const { data: convs } = await db.from("conversations").select("id, buyer_id").eq("listing_id", sale.listing_id).eq("seller_id", rule.user_id);
        const shippingDays = (cfg.shippingDays as number[]) ?? [1, 3, 5];
        const dayLabel = nextShippingDayLabel(shippingDays);
        const template = (cfg.template as string) || "Merci pour votre achat ! J'envoie votre colis {{nextShippingDay}}, vous recevrez le numero de suivi juste apres. 🙏";
        const body = renderTemplate(template, { nextShippingDay: dayLabel });

        for (const conv of convs ?? []) {
          await db.from("messages").insert({ conversation_id: conv.id, sender_id: rule.user_id, body });
        }
        await log(db, rule.id, rule.user_id, sale.listing_id, "post_sale_message", `sale:${sale.id}`);
        actions++;
      }
    }

    // --- auto_relist ---
    if (rule.type === "auto_relist") {
      const { data: soldListings } = await db
        .from("listings")
        .select("*")
        .eq("seller_id", rule.user_id)
        .in("status", ["sold", "archived"])
        .gte("updated_at", since);

      for (const listing of soldListings ?? []) {
        const { data: already } = await db
          .from("automation_log")
          .select("id")
          .eq("rule_id", rule.id)
          .eq("listing_id", listing.id)
          .eq("action", "auto_relist")
          .maybeSingle();
        if (already) continue;

        const { data: newListing, error } = await db
          .from("listings")
          .insert({
            seller_id: listing.seller_id,
            title: listing.title,
            description: listing.description,
            price_cents: listing.price_cents,
            category: listing.category,
            size: listing.size,
            condition: listing.condition,
          })
          .select("id")
          .single();
        if (error || !newListing) continue;

        const { data: images } = await db.from("listing_images").select("storage_path, position").eq("listing_id", listing.id);
        if (images && images.length > 0) {
          await db.from("listing_images").insert(images.map((img) => ({ listing_id: newListing.id, storage_path: img.storage_path, position: img.position })));
        }

        await log(db, rule.id, rule.user_id, listing.id, "auto_relist", `new_listing:${newListing.id}`);
        actions++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, actions }), { status: 200, headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "*/15 * * * *" };
