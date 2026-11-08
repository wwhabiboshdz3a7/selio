import {
  ACCOUNT_CHECKLIST, ACCOUNT_CHECKLIST_SECTIONS, ACCOUNT_CHECKLIST_SECTION_LABELS, ACCOUNT_CHECKLIST_STEP_IDS, COMPTES_INDEPENDENCE_NOTICE, COMPTES_SCOPE_NOTICE,
  accountChecklistProgressInput, accountTextsInput, quotasForPlan,
  type AccountChecklistProgress, type AccountChecklistProgressEntry, type AccountChecklistStepId, type AccountChecklistView, type AccountTextsInput, type AccountTextsResult, type AccountTextsTemplateReason,
} from "@selio/contracts";
import { AIError, buildAccountTextsRequest, fallbackAccountTexts, toAIError, validateAccountTexts } from "@selio/ai";
import { repos, type Tx } from "@selio/db";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import { runStructuredAi } from "./pricing";

/**
 * Selio Comptes (ex « Générateur », §5.15) : checklist de mise en place d'une boutique Vinted et textes à
 * recopier (présentation, règles d'envoi, réponses types, mots-dièse). JAMAIS d'action à la place du client :
 * aucun compte créé, aucune connexion ni aucun appel vers Vinted. Seul appel sortant : mon IA perso (passerelle
 * IA de Selio, quota IA mensuel de l'organisation), avec un gabarit sans IA signalé comme tel en repli.
 *
 * Droits :
 * - checklist et progression en lecture : « org.read » (tous les rôles sauf le contributeur photos) ;
 * - cocher une étape : « org.update » (titulaire, administrateur) : c'est le titulaire du compte Vinted qui
 *   confirme avoir fait l'étape ;
 * - rédiger les textes : « ai.use » (titulaire, administrateur, exécuteur), décompté du quota IA.
 */

// ---------------------------------------------------------------- checklist et progression

const STEP_SET: ReadonlySet<string> = new Set(ACCOUNT_CHECKLIST_STEP_IDS);

async function progressTx(tx: Tx, orgId: string): Promise<AccountChecklistProgress> {
  const rows = await tx.query<{ stepId: string; done: boolean; doneAt: string | null }>("select step_id, done, done_at from account_checklist_progress where org_id = $1", [orgId]);
  const byStep = new Map(rows.filter((r) => STEP_SET.has(r.stepId)).map((r) => [r.stepId, r]));
  const steps: AccountChecklistProgressEntry[] = ACCOUNT_CHECKLIST_STEP_IDS.map((stepId) => {
    const r = byStep.get(stepId);
    return { stepId, done: r?.done === true, doneAt: r?.done ? r.doneAt : null };
  });
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  return { steps, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Progression de l'organisation (cases cochées). */
export async function getProgress(ctx: OrgContext): Promise<AccountChecklistProgress> {
  requireAction(ctx, "org.read");
  return withOrg(ctx, (tx) => progressTx(tx, ctx.orgId));
}

/** Checklist complète : étapes fixes (aucune IA), progression de l'organisation et mentions. */
export async function getChecklist(ctx: OrgContext): Promise<AccountChecklistView> {
  requireAction(ctx, "org.read");
  const progress = await withOrg(ctx, (tx) => progressTx(tx, ctx.orgId));
  const state = new Map(progress.steps.map((s) => [s.stepId, s]));
  return {
    steps: ACCOUNT_CHECKLIST.map((step) => ({ ...step, actions: [...step.actions], done: state.get(step.id)?.done ?? false, doneAt: state.get(step.id)?.doneAt ?? null })),
    sections: ACCOUNT_CHECKLIST_SECTIONS.map((id) => ({ id, label: ACCOUNT_CHECKLIST_SECTION_LABELS[id] })),
    progress,
    scopeNotice: COMPTES_SCOPE_NOTICE,
    independenceNotice: COMPTES_INDEPENDENCE_NOTICE,
  };
}

/**
 * Coche ou décoche une étape. La date d'une étape déjà cochée est conservée ; décochée, elle repart à zéro.
 * Journal d'audit seulement si l'état change (aucun texte libre enregistré).
 */
export async function setProgress(ctx: OrgContext, raw: unknown): Promise<AccountChecklistProgress> {
  requireAction(ctx, "org.update");
  const parsed = accountChecklistProgressInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Étape invalide", 400, parsed.error.flatten());
  const { stepId, done } = parsed.data;
  return withOrg(ctx, async (tx) => {
    const before = await tx.maybeOne<{ done: boolean; doneAt: string | null }>("select done, done_at from account_checklist_progress where org_id = $1 and step_id = $2 for update", [ctx.orgId, stepId]);
    const doneAt = done ? (before?.done && before.doneAt ? before.doneAt : nowIso(ctx)) : null;
    await tx.query(
      `insert into account_checklist_progress (org_id, step_id, done, done_at, updated_by, updated_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id, step_id) do update set done = excluded.done, done_at = excluded.done_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [ctx.orgId, stepId, done, doneAt, ctx.userId, nowIso(ctx)],
    );
    if ((before?.done ?? false) !== done) {
      await repos.audit.add(tx, { actorUserId: ctx.userId, action: done ? "comptes.step_checked" : "comptes.step_unchecked", targetType: "account_checklist", targetId: stepId satisfies AccountChecklistStepId, meta: {}, ip: ctx.ip });
    }
    return progressTx(tx, ctx.orgId);
  });
}

// ---------------------------------------------------------------- textes (mon IA perso)

const TEMPLATE_REASON_TEXT: Record<AccountTextsTemplateReason, string> = {
  ai_disabled: "mon IA perso est désactivée dans les paramètres",
  quota_exceeded: "le quota IA du mois est atteint",
  ai_unavailable: "mon IA perso est indisponible pour le moment",
  invalid_output: "la proposition de mon IA perso a été écartée par les contrôles",
};

const AI_MESSAGE = "Textes rédigés par mon IA perso et vérifiés. Relisez-les, adaptez-les à votre façon de travailler, puis recopiez-les vous-même dans Vinted : Selio ne publie rien à votre place.";

function templateResult(input: AccountTextsInput, reason: AccountTextsTemplateReason): AccountTextsResult {
  return {
    texts: fallbackAccountTexts(input),
    source: "template",
    reason,
    message: `Gabarit sans IA (${TEMPLATE_REASON_TEXT[reason]}). Relisez-le, adaptez-le, puis recopiez-le vous-même dans Vinted : Selio ne publie rien à votre place.`,
    style: input.style,
    tone: input.tone,
    provider: null,
    model: null,
    simulated: false,
    independenceNotice: COMPTES_INDEPENDENCE_NOTICE,
  };
}

async function auditTexts(ctx: OrgContext, input: AccountTextsInput, source: AccountTextsResult["source"], reason: AccountTextsTemplateReason | null): Promise<void> {
  // Ni le nom de la boutique ni les textes : seulement le style, le ton et l'origine.
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "comptes.texts_generated", targetType: "organization", targetId: ctx.orgId, meta: { style: input.style, tone: input.tone, source, reason }, ip: ctx.ip }));
}

/**
 * Textes de boutique à partir du style choisi. Mon IA perso rédige (requête décomptée du quota IA, sorte
 * « listing_description » : un texte de présentation), la sortie est vérifiée (`validateAccountTexts` : ni lien,
 * ni coordonnée, ni renvoi hors de Vinted, ni promesse, ni chiffre, ni information inventée sur la personne).
 * IA désactivée, quota atteint, panne ou sortie écartée : gabarit sans IA, signalé « template ». Annulation : levée.
 */
export async function generateTexts(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<AccountTextsResult> {
  requireAction(ctx, "ai.use");
  const parsed = accountTextsInput.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  const services = ctx.services;
  const org = await services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  if (!org.settings.ai.enabled) {
    await auditTexts(ctx, input, "template", "ai_disabled");
    return templateResult(input, "ai_disabled");
  }
  const now = services.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const gate = await withOrg(ctx, async (tx) => {
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
    const quota = Math.min(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota || Infinity);
    if ((await repos.aiRequests.countSince(tx, monthStart)) >= quota) return null;
    return repos.aiRequests.create(tx, { kind: "listing_description", provider: services.ai.provider.name, model: services.ai.provider.model, status: "running" });
  });
  if (!gate) {
    await auditTexts(ctx, input, "template", "quota_exceeded");
    return templateResult(input, "quota_exceeded");
  }
  const started = Date.now();
  try {
    const res = await runStructuredAi(services, buildAccountTextsRequest({ style: input.style, tone: input.tone, shopName: input.shopName ?? null }), signal);
    const v = validateAccountTexts(res.data, { shopName: input.shopName ?? null });
    await withOrg(ctx, async (tx) => {
      await repos.aiRequests.update(tx, gate.id, { status: v.ok ? "succeeded" : "rejected", validated: v.ok, rejectionReason: v.ok ? null : v.reason.slice(0, 300), promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens, latencyMs: Math.max(res.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
      await repos.usage.record(tx, "ai.request", { requestId: gate.id, kind: "account_texts" });
    });
    if (!v.ok) {
      await auditTexts(ctx, input, "template", "invalid_output");
      return templateResult(input, "invalid_output");
    }
    await auditTexts(ctx, input, "ai", null);
    return {
      texts: v.output,
      source: "ai",
      reason: null,
      message: AI_MESSAGE,
      style: input.style,
      tone: input.tone,
      provider: res.provider,
      model: res.model,
      simulated: res.provider === "mock",
      independenceNotice: COMPTES_INDEPENDENCE_NOTICE,
    };
  } catch (err) {
    const e = err instanceof AIError ? err : toAIError(err);
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, gate.id, { status: e.code === "timeout" ? "timeout" : e.code === "cancelled" ? "cancelled" : e.code === "invalid_output" ? "rejected" : "failed", error: e.message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) })).catch(() => undefined);
    if (e.code === "cancelled") throw new AppError("cancelled", "Demande annulée.", 499);
    const reason: AccountTextsTemplateReason = e.code === "quota_exceeded" ? "quota_exceeded" : e.code === "invalid_output" ? "invalid_output" : "ai_unavailable";
    await auditTexts(ctx, input, "template", reason);
    return templateResult(input, reason);
  }
}
