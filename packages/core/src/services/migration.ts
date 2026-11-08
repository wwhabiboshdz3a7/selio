import {
  MIGRATION_MAX_SCREENSHOTS, MIGRATION_MAX_TEXT_CHARS, automationRuleCreate, migrationFileInput, migrationMapping, migrationSource, quotasForPlan,
  type MigrationMapping, type MigrationSource, type Organization, type RuleConfig, type RuleKind,
} from "@selio/contracts";
import { AIError, buildSettingsMigrationRequest, providerCanSeeImages, validateMigrationMapping, type MigrationRejection, type MigrationSimulatorHints } from "@selio/ai";
import { repos, type Tx } from "@selio/db";
import { MIGRATION_FORBIDDEN_NOTE, applyMapping, mergeMappingCorrection, parseRgpdExport, parseSettingsText, sanitizeUntrustedText, suggestMappingFromCandidates, type AppliedField, type SkippedField } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";

/**
 * Migration depuis un autre outil (Bleam, Clemz, V-Tools…, §5.13). Le client COLLE ses réglages, envoie
 * des CAPTURES (lues par le modèle 1) ou importe un FICHIER obtenu au titre de la portabilité RGPD ; mon
 * IA perso propose une correspondance « ancien → nouveau » que le client valide champ par champ.
 *
 * INTERDIT, et absent de ce module : demander des identifiants d'un autre outil, se connecter à leurs
 * comptes, lire leurs serveurs, contourner une protection. Aucune requête réseau ici : la seule sortie
 * est le fournisseur d'IA configuré (Ollama sur notre machine, ou le simulateur).
 *
 * Ce qui est gardé : la correspondance (brouillon puis appliquée) ; le texte collé ou le fichier, 7 jours
 * au plus (`MIGRATION_RAW_INPUT_DAYS`, purge par le worker) ; jamais les captures (leur nombre seulement).
 * L'application n'écrit que les champs acceptés, revalidés par le schéma, avec un journal d'audit.
 */

export const MIGRATION_RAW_INPUT_DAYS = 7;

export interface MigrationView {
  id: string;
  source: string;
  inputKind: "text" | "screenshot" | "rgpd_file";
  status: "draft" | "applied";
  mapping: MigrationMapping;
  /** Texte collé ou fichier encore gardé (effacé 7 jours après la conversion). */
  rawInputKept: boolean;
  rawInputPurgeAt: string | null;
  screenshotCount: number;
  appliedFieldIds: string[];
  appliedAt: string | null;
  createdAt: string;
}

export interface ConvertResult extends MigrationView {
  /** « ai » : mon IA perso ; « catalog » : équivalences connues, sans IA (IA désactivée ou indisponible). */
  convertedBy: "ai" | "catalog";
  simulated: boolean;
  rejected: MigrationRejection[];
  warnings: string[];
  note: string;
  /** Ce qui a servi : mon IA perso (texte, captures ; repli sur le catalogue signalé par `convertedBy`) ou le fichier RGPD. */
  via: "ai" | "file";
  /** Format du fichier importé ; null pour un texte collé ou des captures. */
  fileFormat: "json" | "csv" | "text" | "empty" | null;
}

export interface ApplyResult {
  migration: MigrationView;
  /** Organisation après application (réglages revalidés). */
  organization: Organization;
  applied: AppliedField[];
  skipped: SkippedField[];
  /** Règles d'automatisation mises à jour ou créées (désactivées) avec les réglages migrés. */
  rules: { id: string; kind: RuleKind; created: boolean }[];
  /** Types de règles touchés (forme attendue par l'écran « ancien → nouveau »). */
  rulesUpdated: RuleKind[];
  note: string;
}

function toView(r: repos.MigrationMappingRecord): MigrationView {
  const parsed = migrationMapping.safeParse(r.mapping);
  return {
    id: r.id, source: r.source, inputKind: r.inputKind, status: r.status,
    mapping: parsed.success ? parsed.data : { source: "unknown", fields: [], unknownFields: [], warnings: ["Correspondance illisible : à refaire."] },
    rawInputKept: r.rawInput !== null, rawInputPurgeAt: r.rawInputPurgeAt, screenshotCount: r.screenshotCount,
    appliedFieldIds: r.appliedFieldIds, appliedAt: r.appliedAt, createdAt: r.createdAt,
  };
}

const purgeAt = (ctx: OrgContext) => new Date(ctx.services.now().getTime() + MIGRATION_RAW_INPUT_DAYS * 86_400_000).toISOString();

export interface ConvertInput {
  text?: string;
  /** Captures d'écran réduites (data URL ou base64 brut), 4 au plus ; `screenshots` est accepté aussi. */
  images?: string[];
  screenshots?: string[];
  declaredSource?: MigrationSource | null;
  /** Indices du simulateur (démonstration des captures) : ignorés avec un vrai modèle. */
  simulator?: MigrationSimulatorHints;
}

function parseConvertInput(raw: unknown): { text: string; images: string[]; declaredSource: MigrationSource | null; simulator?: MigrationSimulatorHints } {
  const body = (raw && typeof raw === "object" ? raw : {}) as ConvertInput;
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > MIGRATION_MAX_TEXT_CHARS) throw new AppError("validation", `Texte trop long (${MIGRATION_MAX_TEXT_CHARS} caractères au plus).`, 400);
  const list = Array.isArray(body.images) ? body.images : Array.isArray(body.screenshots) ? body.screenshots : [];
  const images = list.filter((i): i is string => typeof i === "string" && i.length > 0);
  if (images.length > MIGRATION_MAX_SCREENSHOTS) throw new AppError("validation", `${MIGRATION_MAX_SCREENSHOTS} captures au plus par conversion.`, 400);
  for (const img of images) {
    if (img.length > 3_000_000) throw new AppError("validation", "Capture trop lourde : réduisez-la (1 024 px de côté au plus).", 400);
    if (img.startsWith("data:") && !/^data:image\/(jpeg|png|webp);base64,/.test(img)) throw new AppError("validation", "Capture JPEG, PNG ou WebP attendue.", 400);
  }
  if (text.trim().length === 0 && images.length === 0) throw new AppError("validation", "Collez vos réglages ou ajoutez une capture d'écran.", 400);
  const src = migrationSource.safeParse(body.declaredSource);
  return { text, images, declaredSource: src.success ? src.data : null, simulator: body.simulator && typeof body.simulator === "object" ? body.simulator : undefined };
}

async function checkAiQuota(ctx: OrgContext): Promise<void> {
  const monthStart = new Date(Date.UTC(ctx.services.now().getUTCFullYear(), ctx.services.now().getUTCMonth(), 1)).toISOString();
  await withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
    const used = await repos.aiRequests.countSince(tx, monthStart);
    const quota = Math.min(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota || Infinity);
    if (used >= quota) throw new AppError("quota_exceeded", `Quota IA mensuel atteint (${quota}).`, 402);
  });
}

/**
 * Conversion des réglages collés ou photographiés. Avec mon IA perso (et le modèle 1 pour les captures) :
 * proposition validée (rien d'inventé, aucun secret, aucun lien). IA désactivée ou indisponible : le texte
 * collé passe par le catalogue d'équivalences connues, sans IA ; des captures sans modèle de vision sont refusées.
 */
export async function convertSettings(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<ConvertResult> {
  requireAction(ctx, "org.update");
  const input = parseConvertInput(raw);
  const ai = ctx.services.ai;
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  const aiEnabled = org.settings.ai.enabled;
  if (input.images.length > 0) {
    if (!aiEnabled) throw new AppError("ai_unavailable", "Mon IA perso est désactivée dans les paramètres : les captures ne peuvent pas être lues. Collez vos réglages en texte.", 409);
    if (!providerCanSeeImages(ai.provider)) throw new AppError("ai_unavailable", "Aucun modèle de vision (modèle 1) configuré : les captures ne peuvent pas être lues, rien n'est deviné. Collez vos réglages en texte.", 409);
  }

  let convertedBy: ConvertResult["convertedBy"] = "catalog";
  let mapping: MigrationMapping;
  let rejected: MigrationRejection[] = [];
  const warnings: string[] = [];
  if (aiEnabled) {
    await checkAiQuota(ctx);
    const req = (() => {
      try {
        return buildSettingsMigrationRequest({ text: input.text, images: input.images, declaredSource: input.declaredSource, simulator: ai.provider.name === "mock" ? input.simulator : undefined });
      } catch (err) {
        throw new AppError("validation", err instanceof Error ? err.message : "Entrée refusée", 400);
      }
    })();
    const started = Date.now();
    const record = await withOrg(ctx, (tx) => repos.aiRequests.create(tx, { kind: "summary", provider: ai.provider.name, model: ai.provider.model, status: "running" }));
    try {
      const res = await ai.queue.enqueue(() => ai.breaker.run(() => ai.provider.generateStructured(req, { signal, timeoutMs: ai.limits.timeoutMs })), signal);
      const v = validateMigrationMapping(res.data, { sourceText: input.text.trim() ? input.text : undefined, fromImages: input.images.length > 0, declaredSource: input.declaredSource });
      mapping = v.mapping;
      rejected = v.rejected;
      convertedBy = "ai";
      await withOrg(ctx, async (tx) => {
        await repos.aiRequests.update(tx, record.id, { status: "succeeded", promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens, latencyMs: Math.max(res.latencyMs, Date.now() - started), validated: true, rejectionReason: rejected.length > 0 ? `${rejected.length} champ(s) écarté(s)` : null, finishedAt: nowIso(ctx) });
        await repos.usage.record(tx, "ai.request", { requestId: record.id, kind: "settings_migration" });
      });
    } catch (err) {
      const e = err instanceof AIError ? err : null;
      await withOrg(ctx, (tx) => repos.aiRequests.update(tx, record.id, { status: e?.code === "timeout" ? "timeout" : e?.code === "cancelled" ? "cancelled" : e?.code === "invalid_output" ? "rejected" : "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) }));
      // Captures sans IA : rien ne peut être lu. Texte : le catalogue d'équivalences prend le relais, sans rien inventer.
      if (input.images.length > 0 && !input.text.trim()) throw new AppError("ai_unavailable", `Mon IA perso est indisponible (${e?.code ?? "erreur"}) : les captures n'ont pas pu être lues. Réessayez ou collez vos réglages en texte.`, 503);
      mapping = suggestMappingFromCandidates(parseSettingsText(input.text), input.declaredSource ?? "unknown");
      warnings.push("Mon IA perso est indisponible : correspondance proposée à partir des équivalences connues seulement. Vérifiez chaque champ.");
    }
  } else {
    mapping = suggestMappingFromCandidates(parseSettingsText(input.text), input.declaredSource ?? "unknown");
    warnings.push("Mon IA perso est désactivée : correspondance proposée à partir des équivalences connues seulement. Vérifiez chaque champ.");
  }
  const saved = await withOrg(ctx, async (tx) => {
    const m = await repos.migrationMappings.create(tx, {
      source: mapping.source, inputKind: input.images.length > 0 && !input.text.trim() ? "screenshot" : "text", mapping,
      rawInput: input.text.trim() ? sanitizeUntrustedText(input.text, MIGRATION_MAX_TEXT_CHARS) : null, rawInputPurgeAt: purgeAt(ctx),
      screenshotCount: input.images.length, createdBy: ctx.userId.slice(0, 64), createdAt: nowIso(ctx),
    });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "migration.converted", targetType: "migration_mapping", targetId: m.id, meta: { source: m.source, inputKind: m.inputKind, fields: mapping.fields.length, unknownFields: mapping.unknownFields.length, screenshots: input.images.length, convertedBy }, ip: ctx.ip });
    return m;
  });
  return { ...toView(saved), convertedBy, simulated: convertedBy === "ai" && ai.provider.name === "mock", rejected, warnings: [...mapping.warnings, ...warnings], note: MIGRATION_FORBIDDEN_NOTE, via: "ai", fileFormat: null };
}

/**
 * Fichier obtenu par le client au titre de la portabilité RGPD (JSON, CSV ou texte, format libre) : lu sur
 * place, passé par le catalogue d'équivalences connues. Aucun schéma supposé, aucune connexion à l'outil d'origine.
 */
export async function importRgpdFile(ctx: OrgContext, raw: unknown): Promise<ConvertResult> {
  requireAction(ctx, "org.update");
  const parsed = migrationFileInput.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", "Fichier invalide", 400, parsed.error.flatten());
  const file = parseRgpdExport(parsed.data.content);
  if (file.format === "empty" || file.candidates.length === 0) throw new AppError("validation", "Aucun réglage lisible dans ce fichier.", 400, { warnings: file.warnings });
  const mapping = suggestMappingFromCandidates(file.candidates, parsed.data.declaredSource ?? "unknown");
  return withOrg(ctx, async (tx) => {
    const m = await repos.migrationMappings.create(tx, { source: mapping.source, inputKind: "rgpd_file", mapping, rawInput: sanitizeUntrustedText(parsed.data.content, 2_000_000), rawInputPurgeAt: purgeAt(ctx), createdBy: ctx.userId.slice(0, 64), createdAt: nowIso(ctx) });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "migration.file_imported", targetType: "migration_mapping", targetId: m.id, meta: { source: m.source, format: file.format, fields: mapping.fields.length, unknownFields: mapping.unknownFields.length }, ip: ctx.ip });
    return { ...toView(m), convertedBy: "catalog" as const, simulated: false, rejected: [], warnings: [...mapping.warnings, ...file.warnings], note: MIGRATION_FORBIDDEN_NOTE, via: "file" as const, fileFormat: file.format };
  });
}

export async function listMigrations(ctx: OrgContext): Promise<MigrationView[]> {
  requireAction(ctx, "org.read");
  return withOrg(ctx, async (tx) => (await repos.migrationMappings.list(tx)).map(toView));
}

export async function getMigration(ctx: OrgContext, id: string): Promise<MigrationView> {
  requireAction(ctx, "org.read");
  return withOrg(ctx, async (tx) => {
    const m = await repos.migrationMappings.byId(tx, id);
    if (!m) throw new AppError("not_found", "Migration introuvable", 404);
    return toView(m);
  });
}

/** Corrections du client sur l'écran « ancien → nouveau » (brouillon seulement), validées par le schéma et limitées à la cible et la valeur des champs proposés. */
export async function saveMapping(ctx: OrgContext, id: string, raw: unknown): Promise<MigrationView> {
  requireAction(ctx, "org.update");
  const body = (raw && typeof raw === "object" ? raw : {}) as { mapping?: unknown };
  const parsed = migrationMapping.safeParse(body.mapping ?? raw);
  if (!parsed.success) throw new AppError("validation", "Correspondance invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const existing = await repos.migrationMappings.byId(tx, id);
    if (!existing) throw new AppError("not_found", "Migration introuvable", 404);
    const stored = migrationMapping.safeParse(existing.mapping);
    if (!stored.success) throw new AppError("validation", "Correspondance illisible : refaites la conversion.", 400);
    // Seules la cible et la valeur des champs déjà proposés changent (jamais une correspondance réécrite par le client).
    const merged = mergeMappingCorrection(stored.data, parsed.data);
    const saved = await repos.migrationMappings.updateDraft(tx, id, { mapping: merged, source: merged.source });
    if (!saved) throw new AppError("conflict", "Cette migration est déjà appliquée : refaites une conversion pour la modifier.", 409);
    return toView(saved);
  });
}

/** Fusionne les réglages migrés dans les règles de ce type ; sans règle, en crée une DÉSACTIVÉE (le client l'active). */
async function applyRuleConfigsTx(ctx: OrgContext, tx: Tx, ruleConfigs: Partial<Record<RuleKind, Partial<RuleConfig>>>): Promise<ApplyResult["rules"]> {
  const out: ApplyResult["rules"] = [];
  const rules = await repos.rules.list(tx);
  for (const [kind, config] of Object.entries(ruleConfigs) as [RuleKind, Partial<RuleConfig>][]) {
    const existing = rules.filter((r) => r.kind === kind);
    if (existing.length > 0) {
      for (const r of existing) {
        const merged = automationRuleCreate.safeParse({ ...r, config: { ...r.config, ...config } });
        if (!merged.success) continue;
        await repos.rules.update(tx, r.id, merged.data);
        out.push({ id: r.id, kind, created: false });
      }
      continue;
    }
    const fresh = automationRuleCreate.safeParse({ name: "Réglage migré (à activer)", kind, enabled: false, requiresApproval: true, runsIn: "server", config });
    if (!fresh.success) continue;
    const r = await repos.rules.create(tx, fresh.data);
    out.push({ id: r.id, kind, created: true });
  }
  return out;
}

/**
 * Applique une correspondance ENREGISTRÉE par une conversion (`id` obligatoire) : seuls les champs ACCEPTÉS
 * (identifiants de l'écran) sont écrits, revalidés par le schéma ; les autres réglages ne bougent pas. Une
 * seule application par correspondance (le brouillon est marqué « appliqué »). Audit.
 * `corrected` : correspondance corrigée sur l'écran « ancien → nouveau » ; seules la cible et la valeur des
 * champs déjà proposés sont reprises (`mergeMappingCorrection`) : une correspondance venue entièrement du
 * client, sans les vérifications de la conversion (rien d'inventé, aucun secret), n'est jamais appliquée.
 */
export async function applyMigration(ctx: OrgContext, id: string | null, acceptedFieldIds: unknown, corrected?: unknown): Promise<ApplyResult> {
  requireAction(ctx, "org.update");
  if (!Array.isArray(acceptedFieldIds) || acceptedFieldIds.length > 60 || !acceptedFieldIds.every((f) => typeof f === "string" && f.length > 0 && f.length <= 40)) {
    throw new AppError("validation", "Liste des champs acceptés invalide.", 400);
  }
  if (!id) throw new AppError("validation", "Correspondance à appliquer manquante : convertissez d'abord vos réglages (mappingId).", 400);
  const correction = corrected === undefined || corrected === null ? null : migrationMapping.safeParse(corrected);
  if (correction && !correction.success) throw new AppError("validation", "Correspondance invalide", 400, correction.error.flatten());
  const accepted = [...new Set(acceptedFieldIds as string[])];
  return withOrg(ctx, async (tx) => {
    const targetId = id;
    const m = await repos.migrationMappings.lock(tx, targetId);
    if (!m) throw new AppError("not_found", "Migration introuvable", 404);
    if (m.status === "applied") throw new AppError("conflict", "Cette migration est déjà appliquée.", 409);
    const storedMapping = migrationMapping.safeParse(m.mapping);
    if (!storedMapping.success) throw new AppError("validation", "Correspondance illisible : refaites la conversion.", 400);
    const merged = mergeMappingCorrection(storedMapping.data, correction?.data ?? null);
    if (correction?.data) await repos.migrationMappings.updateDraft(tx, targetId, { mapping: merged, source: merged.source });
    const mapping = { success: true as const, data: merged };
    const known = new Set(mapping.data.fields.map((f) => f.id));
    const unknownIds = accepted.filter((f) => !known.has(f));
    if (unknownIds.length > 0) throw new AppError("validation", `Champ(s) inconnu(s) : ${unknownIds.join(", ").slice(0, 200)}`, 400);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const result = applyMapping(org.settings, mapping.data, accepted);
    const organization = result.applied.some((a) => !a.target.startsWith("followUp.")) ? await repos.orgs.update(tx, ctx.orgId, { settings: result.settings }) : org;
    const rules = await applyRuleConfigsTx(ctx, tx, result.ruleConfigs);
    const appliedIds = result.applied.map((a) => a.id);
    const saved = await repos.migrationMappings.markApplied(tx, targetId, { appliedFieldIds: appliedIds, appliedResult: { applied: result.applied, skipped: result.skipped, rules }, appliedBy: ctx.userId.slice(0, 64), appliedAt: nowIso(ctx) });
    if (!saved) throw new AppError("conflict", "Cette migration est déjà appliquée.", 409);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "migration.applied", targetType: "migration_mapping", targetId, meta: { source: m.source, applied: result.applied.map((a) => a.target), skipped: result.skipped.length, rules: rules.map((r) => r.kind) }, ip: ctx.ip });
    return { migration: toView(saved), organization, applied: result.applied, skipped: result.skipped, rules, rulesUpdated: [...new Set(rules.map((r) => r.kind))], note: MIGRATION_FORBIDDEN_NOTE };
  });
}

/** Rétention (worker) : efface les textes collés et fichiers arrivés à 7 jours, toutes organisations. */
export function purgeRawInputs(services: OrgContext["services"], now: Date = services.now()): Promise<number> {
  return services.db.withGlobal((tx) => repos.migrationMappings.purgeRawInputsAll(tx, now.toISOString()));
}
