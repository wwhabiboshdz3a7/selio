import type { AutomationRule, RuleKind } from "@selio/contracts";
import { automationRuleCreate } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import type { OrgContext } from "../context";

/**
 * Plein automatique (D63, D64) : activer Selio Cloud sur un compte, ou l'automatisation complète par
 * l'extension, est le choix explicite du vendeur, après acceptation du texte d'accord qui dit que les
 * réponses et la négociation partent SANS validation. Ce choix met donc en place ce qu'il faut pour que
 * rien n'attende un dernier clic :
 * - règles « Réponse automatique » et « Négociation automatique » créées si elles manquent, activées et
 *   sans « Validation avant envoi » (les règles existantes de ces deux sortes sont réglées de même) ;
 * - réglage IA « Validation humaine avant envoi » coupé : la réponse générique est rédigée par l'IA.
 * Le vendeur peut remettre la validation règle par règle à tout moment ; une nouvelle activation la
 * recoupe (c'est le sens de l'activation). Les transmissions au vendeur (litige, défaut…) ne partent
 * jamais seules, quel que soit ce réglage.
 */

const FULL_AUTO_SCHEDULE = { days: [1, 2, 3, 4, 5, 6, 0], startHour: 8, endHour: 23, timezone: "Europe/Paris" };

const FULL_AUTO_RULES: { kind: RuleKind; name: string; config: Record<string, unknown> }[] = [
  {
    kind: "reply_on_new_message",
    name: "Réponse automatique (IA)",
    // Gabarit de secours, utilisé seulement si l'IA est indisponible ou sa réponse refusée.
    config: { useAi: true, template: "Bonjour {{prenom}}, merci pour votre message ! Je reviens vers vous très vite." },
  },
  { kind: "auto_negotiate", name: "Négociation automatique", config: {} },
];

export interface FullAutoResult {
  created: RuleKind[];
  updated: RuleKind[];
  aiApprovalTurnedOff: boolean;
}

export async function ensureFullAutoTx(ctx: OrgContext, tx: Tx, source: "cloud" | "extension"): Promise<FullAutoResult> {
  const out: FullAutoResult = { created: [], updated: [], aiApprovalTurnedOff: false };
  const rules = await repos.rules.list(tx);
  for (const spec of FULL_AUTO_RULES) {
    const existing = rules.filter((r: AutomationRule) => r.kind === spec.kind);
    if (existing.length === 0) {
      const timezone = (await repos.orgs.byId(tx, ctx.orgId)).settings.timezone || FULL_AUTO_SCHEDULE.timezone;
      const input = automationRuleCreate.parse({ name: spec.name, kind: spec.kind, enabled: true, requiresApproval: false, runsIn: "server", schedule: { ...FULL_AUTO_SCHEDULE, timezone }, config: spec.config });
      await repos.rules.create(tx, input);
      out.created.push(spec.kind);
      continue;
    }
    for (const rule of existing) {
      if (rule.enabled && !rule.requiresApproval) continue;
      await repos.rules.update(tx, rule.id, { enabled: true, requiresApproval: false });
      if (!out.updated.includes(spec.kind)) out.updated.push(spec.kind);
    }
  }
  const org = await repos.orgs.byId(tx, ctx.orgId);
  if (org.settings.ai.requireApproval) {
    await repos.orgs.update(tx, ctx.orgId, { settings: { ...org.settings, ai: { ...org.settings.ai, requireApproval: false } } });
    out.aiApprovalTurnedOff = true;
  }
  if (out.created.length || out.updated.length || out.aiApprovalTurnedOff) {
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "automation.full_auto.enabled", targetType: "organization", targetId: ctx.orgId, meta: { source, created: out.created, updated: out.updated, aiApprovalTurnedOff: out.aiApprovalTurnedOff }, ip: ctx.ip });
  }
  return out;
}
