import { ACTIVITY_ACTOR_NAMES, ACTIVITY_VERB_CATEGORY, type ActivityEntry, type ActivityRow, type ItemStatus } from "@selio/contracts";
import { sanitizeUntrustedText } from "./untrusted";

/**
 * Phrases du journal d'activité de Selio Manager (§ journal) : une ligne brute (`ActivityRow`, lue dans les
 * traces existantes ou écrite par `recordActivity`) devient une phrase simple sans sujet, que l'écran précède
 * du nom de l'acteur (« Marie », « Selio », « Studio », « Selio Bot »). Même code pour le serveur et la
 * démonstration. Les prix d'achat n'apparaissent que si `finances` est vrai (rôle avec « finances.read ») ;
 * les prix côté vente (prix affiché, offre, contre-offre, prix de vente) restent visibles, comme dans la
 * messagerie. Jamais de message complet d'acheteur : seulement son prénom ou pseudo.
 */

const euros = (cents: number): string => {
  const s = (Math.abs(cents) / 100).toFixed(2).replace(".", ",");
  const [int, dec] = s.split(",");
  return `${cents < 0 ? "−" : ""}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec} €`;
};

const quoted = (title: string | null): string => (title ? `« ${title} »` : "un article");
const to = (who: string | null): string => (who ? ` à ${who}` : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Champs d'un article, pour « a modifié la fiche (titre, description) ». */
const FIELD_LABELS: Record<string, string> = {
  title: "titre", description: "description", brand: "marque", size: "taille", category: "catégorie", condition: "état",
  photos: "photos", tags: "étiquettes", connectionId: "compte Vinted", floorPriceCents: "prix plancher", listedPriceCents: "prix affiché",
  purchasePriceCents: "prix d'achat", purchaseFeesCents: "frais d'achat", attributes: "attributs", sku: "référence",
};
const FINANCE_ITEM_FIELDS = new Set(["purchasePriceCents", "purchaseFeesCents"]);

const STATUS_PHRASES: Record<ItemStatus, string> = {
  in_stock: "a remis {t} en stock",
  listed: "a mis {t} en vente",
  reserved: "a réservé {t}",
  sold: "a marqué {t} comme vendu",
  archived: "a archivé {t}",
};

const BULK_LABELS: Record<string, string> = {
  archive: "archivage", restore: "restauration", set_status: "changement de statut", set_floor_margin: "prix plancher", add_tag: "étiquette",
  delete: "suppression", set_price: "nouveau prix", adjust_price: "ajustement du prix", republish: "republication",
};

type Changes = Record<string, { from?: unknown; to?: unknown }>;

function changesOf(row: ActivityRow): Changes {
  const c = row.data.changes;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Changes) : {};
}

/** Phrase de l'action, sans le sujet. */
export function activitySummary(row: ActivityRow, opts: { finances: boolean }): string {
  const t = quoted(row.itemTitle);
  const who = row.counterpart;
  const price = row.priceCents;
  const purchase = opts.finances && row.purchaseCents !== null ? ` pour ${euros(row.purchaseCents)}` : "";
  const pending = row.status === "pending";
  const failed = row.status === "failed";
  const custom = str(row.data.summary);
  if (custom) return sanitizeUntrustedText(custom, 200);
  const rule = str(row.data.ruleName);
  switch (row.verb) {
    case "item.created": return `a ajouté l'article ${t}`;
    case "item.imported": return `a importé ${t} (fichier CSV)`;
    case "item.captured": return `a importé ${t} depuis Vinted (extension)`;
    case "item.studio_draft": return `a créé le brouillon ${t}`;
    case "item.radar_bought": return `a ajouté ${t} au stock après un achat Radar${purchase}`;
    case "item.status_changed": {
      const next = str(changesOf(row).status?.to) as ItemStatus | null;
      return (next && STATUS_PHRASES[next] ? STATUS_PHRASES[next] : "a changé le statut de {t}").replace("{t}", t);
    }
    case "item.price_changed": {
      const c = changesOf(row);
      const listed = c.listedPriceCents;
      if (listed && (num(listed.to) !== null || num(listed.from) !== null)) {
        const from = num(listed.from);
        const next = num(listed.to);
        if (from !== null && next !== null) return `a changé le prix de ${t} : ${euros(from)} → ${euros(next)}`;
        if (next !== null) return `a fixé le prix de ${t} à ${euros(next)}`;
        return `a retiré le prix de ${t}`;
      }
      const floor = num(c.floorPriceCents?.to);
      return floor !== null ? `a fixé le prix plancher de ${t} à ${euros(floor)}` : `a changé le prix plancher de ${t}`;
    }
    case "item.updated": {
      const fields = Object.keys(changesOf(row)).filter((k) => opts.finances || !FINANCE_ITEM_FIELDS.has(k)).map((k) => FIELD_LABELS[k] ?? null).filter((v): v is string => v !== null);
      return fields.length ? `a modifié la fiche ${t} (${[...new Set(fields)].slice(0, 4).join(", ")})` : `a modifié la fiche ${t}`;
    }
    case "item.photos_added": {
      const c = changesOf(row).photos;
      const added = num(row.data.count) ?? (num(c?.to) !== null && num(c?.from) !== null ? num(c?.to)! - num(c?.from)! : null);
      return added && added > 0 ? `a ajouté ${added} photo${added > 1 ? "s" : ""} à ${t}` : `a ajouté des photos à ${t}`;
    }
    case "item.republished": {
      const variant = str(row.data.variant);
      return `a republié ${t}${variant ? ` (${variant})` : ""}`;
    }
    case "item.deleted": return `a supprimé l'article ${t}`;
    case "item.bulk": {
      const n = num(row.data.affected) ?? 0;
      const label = BULK_LABELS[str(row.data.action) ?? ""] ?? "modification";
      return `a modifié ${n} article${n > 1 ? "s" : ""} d'un coup (${label})`;
    }
    case "studio.prepared": {
      const photos = num(row.data.photos) ?? 0;
      const label = row.data.labelRead === true;
      const facts = [str(row.data.brand), str(row.data.size) ? `taille ${str(row.data.size)}` : null].filter(Boolean).join(", ");
      const base = `a trié ${photos} photo${photos > 1 ? "s" : ""}`;
      return label ? `${base} et lu l'étiquette${facts ? ` (${facts})` : ""}` : `${base}${facts ? ` (${facts})` : ""}`;
    }
    case "studio.listing_written": return price !== null ? `a rédigé l'annonce ${t} et estimé le prix à ${euros(price)}` : `a rédigé l'annonce ${t}`;
    case "message.sent": {
      const ai = row.data.ai === true ? " rédigée avec l'IA" : "";
      const offer = price !== null ? ` avec une proposition à ${euros(price)}` : "";
      return `a envoyé une réponse${ai}${to(who)}${offer}`;
    }
    case "negotiation.accepted":
      return pending ? `propose d'accepter l'offre de ${who ?? "l'acheteur"}${price !== null ? ` à ${euros(price)}` : ""} (à valider)` : failed ? `n'a pas pu accepter l'offre de ${who ?? "l'acheteur"}` : `a accepté l'offre de ${who ?? "l'acheteur"}${price !== null ? ` à ${euros(price)}` : ""}`;
    case "negotiation.countered":
      return pending ? `propose une contre-offre${to(who)}${price !== null ? ` : ${euros(price)}` : ""} (à valider)` : failed ? `n'a pas pu envoyer la contre-offre${to(who)}` : `a fait une contre-offre${to(who)}${price !== null ? ` : ${euros(price)}` : ""}`;
    case "negotiation.refused":
      return pending ? `propose de refuser l'offre de ${who ?? "l'acheteur"} (à valider)` : failed ? `n'a pas pu répondre à l'offre de ${who ?? "l'acheteur"}` : `a refusé poliment l'offre de ${who ?? "l'acheteur"}`;
    case "followup.sent":
      return pending ? `propose une relance${to(who)} (à valider)` : failed ? `n'a pas pu relancer ${who ?? "l'acheteur"}` : `a relancé ${who ?? "l'acheteur"} (sans réponse depuis 24 h)`;
    case "automation.reply_sent":
      return pending ? `propose une réponse${to(who)} (à valider)` : failed ? `n'a pas pu répondre${to(who)}` : `a répondu automatiquement${to(who)}${rule ? ` (« ${rule} »)` : ""}`;
    case "automation.handoff": return `vous transmet la conversation avec ${who ?? "un acheteur"} : à vous de répondre`;
    case "automation.action":
      return pending ? `propose une action${rule ? ` de « ${rule} »` : ""} sur ${t} (à valider)` : failed ? `n'a pas pu exécuter${rule ? ` « ${rule} »` : " une automatisation"}` : `a exécuté${rule ? ` « ${rule} »` : " une automatisation"} sur ${t}`;
    case "automation.rule_run": {
      const created = num(row.data.created);
      return `a lancé l'automatisation${rule ? ` « ${rule} »` : ""}${created !== null ? ` (${created} action${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""})` : ""}`;
    }
    case "automation.approved": return "a validé une action automatique";
    case "automation.paused": return "a mis en pause toutes les automatisations";
    case "automation.resumed": return "a relancé les automatisations";
    case "order.created": return `a enregistré la vente de ${t}${to(who)}${price !== null ? ` pour ${euros(price)}` : ""}`;
    case "order.shipped": return `a expédié ${t}${to(who)}`;
    case "order.delivered": return `a noté la livraison de ${t}${to(who)}`;
    case "shipment.label_ready": return `a préparé le bordereau de ${t}`;
    case "purchase.validated": return `a validé l'achat de ${t}${purchase}`;
    case "purchase.done": return `a acheté ${t}${purchase}${row.data.simulated === true ? " (simulé)" : ""}`;
    case "bot.message_sent": return `a envoyé un message${to(who)}`;
    case "bot.offer_sent": return `a envoyé une offre${to(who)}${price !== null ? ` : ${euros(price)}` : ""}`;
    case "bot.offer_answered": return `a répondu à l'offre de ${who ?? "l'acheteur"}`;
    case "bot.purchase": return `a acheté ${t}${purchase}`;
    case "bot.favorite": return `a ajouté ${t} aux favoris`;
    case "bot.action": return "a effectué une action";
  }
}

/** Lien vers l'objet de l'action. */
export function activityLink(row: ActivityRow): string | null {
  if (row.targetType === "conversation" && row.targetId) return `/app/messages/${row.targetId}`;
  if (row.targetType === "order" && row.targetId) return `/app/orders/${row.targetId}`;
  if (row.targetType === "rule" || row.targetType === "job") return "/app/automations";
  if (row.targetType === "purchase") return row.verb === "purchase.done" || row.verb === "bot.purchase" ? "/app/auto-buy" : "/app/purchase";
  if (row.itemId && row.verb !== "item.deleted") return `/app/items/${row.itemId}`;
  if (row.targetType === "studio_prep") return "/studio/annonces";
  return null;
}

/** Ligne affichée : catégorie, acteur nommé, phrase, lien ; prix d'achat retiré sans « finances.read ». */
export function describeActivity(row: ActivityRow, opts: { finances: boolean; memberName?: (userId: string) => string | null }): ActivityEntry {
  const name = row.actorKind === "member"
    ? (row.actorUserId ? opts.memberName?.(row.actorUserId) ?? null : null) ?? "Un membre de l'équipe"
    : ACTIVITY_ACTOR_NAMES[row.actorKind];
  return {
    id: row.id,
    at: row.at,
    category: ACTIVITY_VERB_CATEGORY[row.verb],
    verb: row.verb,
    actor: { kind: row.actorKind, userId: row.actorUserId, name },
    automatic: row.actorKind !== "member",
    status: row.status,
    summary: activitySummary(row, opts),
    link: activityLink(row),
    itemId: row.itemId,
    itemTitle: row.itemTitle,
    counterpart: row.counterpart,
    priceCents: row.priceCents,
    purchaseCents: opts.finances ? row.purchaseCents : null,
  };
}

/** Prénom affiché d'un acheteur : premier mot du nom affiché, sinon le pseudo. */
export function counterpartName(displayName: string | null | undefined, handle?: string | null): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  return first || handle?.trim() || null;
}
