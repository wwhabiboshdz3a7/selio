import { helpAskInput, type HelpAnswer } from "@selio/contracts";
import { repos } from "@selio/db";
import { AIError } from "@selio/ai";
import { answerFromHelp, toHelpSource, type HelpEntry } from "@selio/domain/help";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";

/** Nombre de passages de la FAQ transmis à l'IA. */
const PASSAGES = 4;

/**
 * Assistant d'aide (mode connecté).
 *
 * 1. La recherche de la FAQ (packages/domain/help) retient les passages pertinents.
 * 2. Rien de pertinent : réponse « non trouvée », sans appel à l'IA (rien sur quoi s'appuyer).
 * 3. Sinon, l'IA rédige à partir de ces passages ; sa sortie est validée (pas de lien, pas de
 *    chiffre ni de source hors passages, pas de motif d'injection).
 * 4. IA désactivée, indisponible ou sortie écartée : la réponse de la FAQ est renvoyée, avec
 *    la raison. Ce repli est toujours permis, même en production : c'est le texte de la FAQ,
 *    signalé comme tel, jamais un texte simulé présenté comme venant du modèle.
 *
 * Ouvert à tous les rôles (lecture seule comprise) ; les questions d'aide sont journalisées
 * (kind « help_answer ») mais ne sont pas décomptées du quota IA mensuel du plan.
 */
export async function askHelp(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<HelpAnswer> {
  requireAction(ctx, "org.read");
  const parsed = helpAskInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Question invalide", 400, parsed.error.flatten());
  const question = parsed.data.question;
  const faq = answerFromHelp(question);
  const fromFaq = (fallbackReason: string | null, entries: HelpEntry[] = faq.sources): HelpAnswer => ({
    question,
    answer: faq.answer,
    found: faq.found,
    source: "faq",
    sources: entries.map(toHelpSource),
    simulated: false,
    provider: null,
    model: null,
    fallbackReason,
  });
  if (!faq.found) return fromFaq(null, []);

  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  if (!org.settings.ai.enabled) return fromFaq("L'assistant IA est désactivé dans les paramètres : réponse tirée de la FAQ.");

  const passages = faq.matches.slice(0, PASSAGES).map((m) => ({ id: m.entry.id, question: m.entry.question, answer: m.entry.answer }));
  const ai = ctx.services.ai;
  const req = await withOrg(ctx, (tx) => repos.aiRequests.create(tx, { kind: "help_answer", provider: ai.provider.name, model: ai.provider.model, status: "running" }));
  const started = Date.now();
  try {
    const res = await ai.answerHelp(ctx.orgId, { question, passages }, { signal });
    const latencyMs = Math.max(res.latencyMs, Date.now() - started);
    if (res.data.outOfScope) {
      await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, rejectionReason: "Hors des passages : réponse de la FAQ utilisée", promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens, latencyMs, finishedAt: nowIso(ctx) }));
      return fromFaq("L'IA n'a pas trouvé la réponse dans les passages : réponse tirée de la FAQ.");
    }
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens, latencyMs, finishedAt: nowIso(ctx) }));
    const byId = new Map(faq.matches.map((m) => [m.entry.id, m.entry]));
    const cited = res.data.sourceIds.map((id) => byId.get(id)).filter((e): e is HelpEntry => Boolean(e));
    return {
      question,
      answer: res.data.answer,
      found: true,
      source: "ai",
      sources: (cited.length ? cited : faq.sources).slice(0, 3).map(toHelpSource),
      simulated: res.provider === "mock",
      provider: res.provider,
      model: res.model,
      fallbackReason: null,
    };
  } catch (err) {
    const e = err instanceof AIError ? err : null;
    const latencyMs = Date.now() - started;
    if (e?.code === "invalid_output") {
      // Le modèle a répondu, mais hors des règles : sortie « rejetée » (comme pour la messagerie,
      // l'état de l'IA reste exact), et l'utilisateur voit la réponse de la FAQ, signalée.
      await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: "rejected", validated: false, rejectionReason: `${e.message.slice(0, 240)} : réponse de la FAQ utilisée`, latencyMs, finishedAt: nowIso(ctx) }));
      return fromFaq("La réponse de l'IA a été écartée par les contrôles : réponse tirée de la FAQ.");
    }
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: e?.code === "timeout" ? "timeout" : e?.code === "cancelled" ? "cancelled" : "failed", error: (err as Error).message.slice(0, 500), latencyMs, finishedAt: nowIso(ctx) }));
    return fromFaq(`IA indisponible (${e?.code ?? "erreur"}) : réponse tirée de la FAQ.`);
  }
}
