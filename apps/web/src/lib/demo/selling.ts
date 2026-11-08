import {
  MIGRATION_MAX_SCREENSHOTS, migrationApplyInput, migrationConvertInput, migrationFileInput, migrationMappingOutput,
  negotiationAutomation, type AutomationRule, type Conversation, type Customer, type InventoryItem, type Job, type Message, type MigrationApplyInput, type MigrationConvertInput, type MigrationFileInput, type MigrationMapping, type Order, type OrgSettings, type PurchaseRequest, type RuleConfig, type RuleKind,
} from "@selio/contracts";
import {
  applyMapping, mergeMappingCorrection, decideFollowUp, fillTemplate, followUp24hDedupeKey, followUpModeFor, followUpTemplateAllowed, itemMargins, marginTotals, marginsByPeriod, parseRgpdExport, periodFromPreset, suggestBundles, suggestMappingFromCandidates, thresholdStatusForOrders,
  type PeriodPreset,
} from "@selio/domain";
import { MockAIProvider, buildSettingsMigrationRequest, validateMigrationMapping } from "@selio/ai";
import { DataError, type BundleSuggestionView, type DeclarationThresholdsView, type EndToEndMarginRow, type EndToEndMarginsView, type MigrationConversion } from "../data/types";

/**
 * Négociation avancée et fonctions « que Bleam n'a pas » dans la démonstration (§5.12 à §5.14). Mêmes
 * règles que le serveur : les fonctions pures de @selio/domain décident, mon IA perso (ici le simulateur
 * `MockAIProvider`, sans réseau) propose la correspondance de migration, validée par `validateMigrationMapping`.
 * Aucune requête vers un outil concurrent : seuls le texte collé, les captures et le fichier fourni sont lus.
 */

// ----------------------------------------------------------------- migration (§5.13)

function zodMessage(error: { issues: { message: string }[] }): string {
  return error.issues.map((i) => i.message).join(", ");
}

/** Texte collé et/ou captures → correspondance « ancien → nouveau », par le simulateur et la validation de production. */
export async function demoConvertMigration(input: MigrationConvertInput): Promise<Omit<MigrationConversion, "id">> {
  const parsed = migrationConvertInput.safeParse(input);
  if (!parsed.success) throw new DataError("validation", zodMessage(parsed.error), 400);
  const { text, screenshots, declaredSource } = parsed.data;
  if (screenshots.length > MIGRATION_MAX_SCREENSHOTS) throw new DataError("validation", `${MIGRATION_MAX_SCREENSHOTS} captures au plus`, 400);
  const req = buildSettingsMigrationRequest({ text, images: screenshots, declaredSource });
  const out = await new MockAIProvider().generateStructured(req);
  const v = validateMigrationMapping(migrationMappingOutput.parse(out.data), { sourceText: text, fromImages: screenshots.length > 0, declaredSource });
  const warnings = [...v.mapping.warnings];
  if (screenshots.length > 0) warnings.push("Démonstration : le simulateur ne lit pas réellement les captures. Avec votre compte, mon IA perso (modèle de vision) les lit ; vous vérifiez chaque valeur.");
  return { mapping: { ...v.mapping, warnings: warnings.slice(0, 60) }, rejected: v.rejected, via: "ai", fileFormat: null, simulated: true };
}

/** Fichier obtenu au titre de la portabilité RGPD → correspondance par le catalogue (sans IA), validée de la même façon. */
export function demoImportMigrationFile(input: MigrationFileInput): Omit<MigrationConversion, "id"> {
  const parsed = migrationFileInput.safeParse(input);
  if (!parsed.success) throw new DataError("validation", zodMessage(parsed.error), 400);
  const file = parseRgpdExport(parsed.data.content);
  const suggested = suggestMappingFromCandidates(file.candidates, parsed.data.declaredSource ?? "unknown");
  const raw = migrationMappingOutput.parse({ ...suggested, fields: suggested.fields.map(({ id: _id, ...f }) => f) });
  const v = validateMigrationMapping(raw, { sourceText: parsed.data.content, declaredSource: parsed.data.declaredSource });
  return { mapping: { ...v.mapping, warnings: [...file.warnings, ...v.mapping.warnings].slice(0, 60) }, rejected: v.rejected, via: "file", fileFormat: file.format, simulated: true };
}

/**
 * Application des champs cochés d'une correspondance ENREGISTRÉE (`stored`) : comme le serveur, seules la
 * cible et la valeur des champs proposés sont reprises des corrections ; réglages revalidés, configurations
 * de règles rendues à part.
 */
export function demoApplyMigration(current: OrgSettings, stored: MigrationMapping, input: MigrationApplyInput): { settings: OrgSettings; ruleConfigs: Partial<Record<RuleKind, Partial<RuleConfig>>>; applied: { id: string; target: string; value: number | string | boolean }[]; skipped: { id: string; reason: string }[]; mapping: MigrationMapping } {
  const parsed = migrationApplyInput.safeParse(input);
  if (!parsed.success) throw new DataError("validation", zodMessage(parsed.error), 400);
  const mapping = mergeMappingCorrection(stored, parsed.data.mapping);
  const r = applyMapping(current, mapping, parsed.data.acceptedFieldIds);
  return { ...r, mapping };
}

// ----------------------------------------------------------------- relance après 24 h (§5.12)

export interface FollowUpRunInput {
  rule: AutomationRule;
  conversations: readonly Conversation[];
  messages: readonly Message[];
  customers: readonly Customer[];
  items: readonly InventoryItem[];
  orders: readonly Order[];
  rules: readonly AutomationRule[];
  plan: string;
  /** Gabarit de relance de l'organisation (repli quand la règle n'en a pas, ou un gabarit hors règle). */
  template: string;
  /** Conversations sur un compte Perso : jamais automatisées. */
  personal: ReadonlySet<string>;
  /** Toutes les tâches existantes, QUEL QUE SOIT leur statut (une relance annulée compte comme faite). */
  jobs: readonly Pick<Job, "dedupeKey" | "ruleId" | "payload" | "createdAt">[];
  /** Comptes Vinted dont Selio Cloud est actif (session enregistrée) : seuls ceux-là relancent seuls. */
  activeCloudConnections: ReadonlySet<string>;
  now: Date;
}

export interface FollowUpPlanned {
  conversationId: string;
  customerId: string;
  dedupeKey: string;
  /** « cloud » : envoyé par Selio Cloud (Agence, compte actif) ; « draft » : brouillon à valider. */
  action: "draft" | "cloud";
  /** Brouillon à valider avant envoi (Pro, Agence sans Cloud actif, ou « validation avant envoi » sur la règle). */
  approval: boolean;
  body: string;
  reason: string;
}

const DEFAULT_FOLLOW_UP_TEMPLATE = negotiationAutomation.parse({}).messages.followUp;
const FOLLOW_UP_KINDS: readonly RuleKind[] = ["follow_up_24h", "follow_up_no_reply"];

/**
 * Passage de la règle « relance après 24 h », mêmes règles que le serveur (`runRuleTx`) : une relance au
 * plus par conversation sans réponse, toutes règles de relance confondues (tâches de tout statut et
 * messages depuis le dernier message de l'acheteur) ; jamais hors des heures actives ; jamais sur un
 * article vendu, réservé ou commandé ; même délai (`delayHours`) et même choix de gabarit
 * (`followUpTemplateAllowed`) ; mode selon l'offre, avec repli sur le brouillon sans Cloud actif.
 */
export function planFollowUps(input: FollowUpRunInput): { planned: FollowUpPlanned[]; skipped: Map<string, number>; evaluated: number } {
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const ids = new Set(input.rules.filter((r) => FOLLOW_UP_KINDS.includes(r.kind)).map((r) => r.id));
  const mode = followUpModeFor(input.plan);
  const planned: FollowUpPlanned[] = [];
  const chosen = [input.rule.config.template?.trim() ? input.rule.config.template : null, input.template].find((t): t is string => typeof t === "string" && followUpTemplateAllowed(t)) ?? DEFAULT_FOLLOW_UP_TEMPLATE;
  let evaluated = 0;
  for (const conv of input.conversations) {
    if (conv.status !== "open") continue;
    evaluated++;
    if (conv.connectionId && input.personal.has(conv.connectionId)) { skip("Compte Perso : jamais automatisé"); continue; }
    const dedupeKey = followUp24hDedupeKey(conv.id);
    const msgs = input.messages.filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound") ?? null;
    const sinceReply = msgs.filter((m) => lastInbound === null || m.createdAt > lastInbound.createdAt);
    const followedUp =
      input.jobs.some((j) => j.dedupeKey === dedupeKey) ||
      sinceReply.some((m) => m.direction === "outbound" && m.ruleId !== null && ids.has(m.ruleId) && (m.status !== "failed" || /incertain/i.test(m.error ?? ""))) ||
      input.jobs.some((j) => j.ruleId !== null && ids.has(j.ruleId) && j.payload.conversationId === conv.id && (lastInbound === null || j.createdAt >= lastInbound.createdAt));
    const item = conv.itemId ? input.items.find((i) => i.id === conv.itemId) ?? null : null;
    const itemAvailable = conv.itemId ? item !== null && item.status === "listed" && !input.orders.some((o) => o.itemId === item.id && o.status !== "cancelled" && o.status !== "refunded") : undefined;
    const delivered = msgs.filter((m) => m.status === "sent" || m.status === "received" || m.status === "pending");
    const last = delivered[delivered.length - 1];
    // Même ordre et même texte que le serveur : une relance existante écarte la conversation avant toute autre règle.
    if (followedUp) { skip("Relance déjà faite depuis la dernière réponse de l'acheteur"); continue; }
    const decision = decideFollowUp({
      conversation: { status: conv.status, lastMessageDirection: last?.direction ?? null, lastMessageAt: last ? last.sentAt ?? last.createdAt : null },
      plan: mode, now: input.now, alreadyFollowedUp: false, schedule: input.rule.schedule, delayHours: input.rule.config.delayHours, itemAvailable,
    });
    if (decision.action === "none") { skip(decision.reason); continue; }
    const customer = input.customers.find((c) => c.id === conv.customerId);
    const body = fillTemplate(chosen, { prenom: customer?.displayName.split(" ")[0] ?? "", article: item?.title ?? "l'article" }).replace(/\s+/g, " ").trim();
    const cloud = decision.action === "cloud" && conv.connectionId !== null && input.activeCloudConnections.has(conv.connectionId);
    const approval = !cloud || input.rule.requiresApproval;
    const reason = cloud ? (approval ? "Offre Agence, validation avant envoi : brouillon à valider, envoyé ensuite par Selio Cloud." : decision.reason) : decision.action === "cloud" ? "Offre Agence, Selio Cloud non actif sur ce compte : brouillon à valider dans Messages." : decision.reason;
    planned.push({ conversationId: conv.id, customerId: conv.customerId, dedupeKey, action: cloud ? "cloud" : "draft", approval, body, reason });
  }
  return { planned, skipped, evaluated };
}

// ----------------------------------------------------------------- lots intelligents (§5.14)

export function demoBundles(input: { items: readonly InventoryItem[]; conversations: readonly Conversation[]; customers: readonly Customer[]; settings: OrgSettings; now: Date }): BundleSuggestionView[] {
  // Signal « même acheteur » : les articles des conversations ouvertes de chaque acheteur.
  // Par acheteur ET par compte Vinted, comme le serveur : un lot ne réunit jamais deux vendeurs.
  const interest = new Map<string, { customerId: string; itemIds: string[] }>();
  for (const c of input.conversations) {
    if (c.status !== "open" || !c.itemId) continue;
    const key = `${c.customerId}|${c.connectionId ?? ""}`;
    const g = interest.get(key) ?? { customerId: c.customerId, itemIds: [] };
    g.itemIds.push(c.itemId);
    interest.set(key, g);
  }
  const suggestions = suggestBundles({
    items: input.items,
    signals: { buyerInterest: [...interest.values()] },
    negotiation: input.settings.automation.negotiation,
    rules: input.settings.margin,
    settings: input.settings.bundles,
    now: input.now,
  });
  const byId = new Map(input.items.map((i) => [i.id, i]));
  return suggestions.map((s) => {
    const customer = s.customerId ? input.customers.find((c) => c.id === s.customerId) ?? null : null;
    const conv = s.customerId ? [...input.conversations].filter((c) => c.customerId === s.customerId && c.status === "open").sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""))[0] : undefined;
    return {
      ...s,
      items: s.itemIds.map((id) => byId.get(id)).filter((i): i is InventoryItem => Boolean(i)).map((i) => ({ id: i.id, title: i.title, brand: i.brand, size: i.size, listedPriceCents: i.listedPriceCents, photos: i.photos })),
      customer: customer ? { id: customer.id, displayName: customer.displayName } : null,
      conversationId: conv?.id ?? null,
    };
  });
}

// ----------------------------------------------------------------- marge de bout en bout et seuils (§5.14)

export function demoEndToEndMargins(input: { items: readonly InventoryItem[]; orders: readonly Order[]; purchases: readonly PurchaseRequest[]; period: PeriodPreset; now: Date; rules?: OrgSettings["margin"] }): EndToEndMarginsView {
  const fromRadar = new Set<string>();
  for (const p of input.purchases) if (p.reportedItemId) fromRadar.add(p.reportedItemId);
  for (const it of input.items) if (it.tags.includes("radar")) fromRadar.add(it.id);
  const period = periodFromPreset(input.period, input.now);
  const dated = itemMargins(input.items, input.orders, null, input.rules ?? null);
  const totals = marginsByPeriod(dated, period);
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const inPeriod = (at: string | null) => at !== null && new Date(at) >= period.from && new Date(at) < period.to;
  const rows: EndToEndMarginRow[] = dated
    .filter((d) => d.margin.status === "projected" || inPeriod(d.at))
    .map((d) => ({
      itemId: d.itemId,
      title: byId.get(d.itemId)?.title ?? "Article",
      status: d.margin.status,
      purchaseSource: fromRadar.has(d.itemId) ? "radar" : "manual",
      at: d.at,
      costCents: d.margin.costCents,
      revenueCents: d.margin.revenueCents,
      marginCents: d.margin.marginCents,
      marginRate: d.margin.marginRate,
      priceKnown: d.margin.priceKnown,
    }));
  const radar = marginTotals(dated.filter((d) => fromRadar.has(d.itemId) && (d.margin.status === "projected" || inPeriod(d.at))).map((d) => d.margin));
  return { ...totals, period: input.period, radar, rows: rows.sort((a, b) => (a.status === b.status ? b.marginCents - a.marginCents : a.status === "realized" ? -1 : 1)) };
}

export function demoThresholds(orders: readonly Order[], settings: OrgSettings, now: Date): DeclarationThresholdsView {
  return { ...thresholdStatusForOrders(orders, settings.thresholds, now), enabled: settings.thresholds.enabled };
}
