import { inviteInput, orgSettings as orgSettingsSchema, orgUpdate, type Membership, type Organization, type Role, type User } from "@selio/contracts";
import { repos, hashPassword, newSecret } from "@selio/db";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, requireAction, withOrg, type OrgContext } from "../context";
import type { Session } from "../types";

export async function getSession(ctx: OrgContext): Promise<Session> {
  return ctx.services.db.withGlobal(async (tx) => {
    const user = await repos.users.byId(tx, ctx.userId);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const memberships = await repos.memberships.forUser(tx, ctx.userId);
    return { mode: "connected", user, org, role: ctx.role, memberships };
  });
}

export async function updateOrg(ctx: OrgContext, raw: unknown): Promise<Organization> {
  requireAction(ctx, "org.update");
  const parsed = orgUpdate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Paramètres invalides", 400, parsed.error.flatten());
  return ctx.services.db.withGlobal(async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const input = parsed.data.settings ?? {};
    const merged = orgSettingsSchema.parse({
      ...org.settings, ...input,
      margin: { ...org.settings.margin, ...(input.margin ?? {}) },
      ai: { ...org.settings.ai, ...(input.ai ?? {}) },
      notifications: { ...org.settings.notifications, ...(input.notifications ?? {}) },
      retentionDays: { ...org.settings.retentionDays, ...(input.retentionDays ?? {}) },
      onboarding: { ...org.settings.onboarding, ...(input.onboarding ?? {}) },
    });
    const updated = await repos.orgs.update(tx, ctx.orgId, { name: parsed.data.name?.trim() || org.name, settings: merged });
    await tx.query("select set_config('app.org_id', $1, true)", [ctx.orgId]);
    await repos.audit.add(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "org.updated", targetType: "organization", targetId: ctx.orgId, meta: { fields: Object.keys(input) }, ip: ctx.ip });
    return updated;
  });
}

export async function completeOnboardingStep(ctx: OrgContext, step: string): Promise<Organization> {
  const org = await ctx.services.db.withGlobal((tx) => repos.orgs.byId(tx, ctx.orgId));
  const steps = new Set(org.settings.onboarding.completedSteps);
  steps.add(step.slice(0, 40));
  return updateOrg(ctx, { settings: { onboarding: { completedSteps: [...steps], dismissed: org.settings.onboarding.dismissed } } });
}

export async function listMembers(ctx: OrgContext): Promise<(Membership & { user: User })[]> {
  return ctx.services.db.withGlobal((tx) => repos.memberships.listOrg(tx, ctx.orgId));
}

export async function inviteMember(ctx: OrgContext, raw: unknown): Promise<Membership & { user: User }> {
  requireAction(ctx, "members.manage");
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Invitation invalide", 400, parsed.error.flatten());
  if (parsed.data.role === "owner") throw new AppError("validation", "Le rôle propriétaire ne s'attribue pas par invitation.", 400);
  const quotas = (await withOrg(ctx, (tx) => repos.subscriptions.get(tx)))?.quotas ?? PLAN_QUOTAS.free;
  return ctx.services.db.withGlobal(async (tx) => {
    if ((await repos.memberships.countOrg(tx, ctx.orgId)) >= quotas.members) throw new AppError("quota_exceeded", `Quota de membres atteint (${quotas.members}).`, 402);
    let user = await repos.users.byEmail(tx, parsed.data.email);
    if (!user) {
      // Compte créé avec un mot de passe aléatoire : l'utilisateur le définira via la procédure de réinitialisation (à venir) ou un administrateur le communiquera.
      const { hash, salt } = await hashPassword(newSecret(24));
      const created = await repos.users.create(tx, { email: parsed.data.email, displayName: parsed.data.email.split("@")[0]!, passwordHash: hash, passwordSalt: salt });
      user = { ...created, passwordHash: hash, passwordSalt: salt };
    }
    if (await repos.memberships.get(tx, ctx.orgId, user.id)) throw new AppError("conflict", "Cet utilisateur est déjà membre.", 409);
    const m = await repos.memberships.create(tx, { orgId: ctx.orgId, userId: user.id, role: parsed.data.role });
    await tx.query("select set_config('app.org_id', $1, true)", [ctx.orgId]);
    await repos.audit.add(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "member.invited", targetType: "membership", targetId: m.id, meta: { role: m.role }, ip: ctx.ip });
    return { ...m, user: await repos.users.byId(tx, user.id) };
  });
}

export async function updateMemberRole(ctx: OrgContext, membershipId: string, role: Role): Promise<void> {
  requireAction(ctx, "members.manage");
  await ctx.services.db.withGlobal(async (tx) => {
    const m = await repos.memberships.byId(tx, membershipId);
    if (m.orgId !== ctx.orgId) throw new AppError("not_found", "Membre introuvable", 404);
    if (m.userId === ctx.userId && role !== "owner") throw new AppError("validation", "Impossible de rétrograder votre propre rôle.", 400);
    if (role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Seul un propriétaire peut nommer un propriétaire.", 403);
    await repos.memberships.setRole(tx, membershipId, role);
    await tx.query("select set_config('app.org_id', $1, true)", [ctx.orgId]);
    await repos.audit.add(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "member.role_changed", targetType: "membership", targetId: membershipId, meta: { role }, ip: ctx.ip });
  });
}

export async function removeMember(ctx: OrgContext, membershipId: string): Promise<void> {
  requireAction(ctx, "members.manage");
  await ctx.services.db.withGlobal(async (tx) => {
    const m = await repos.memberships.byId(tx, membershipId);
    if (m.orgId !== ctx.orgId) throw new AppError("not_found", "Membre introuvable", 404);
    if (m.userId === ctx.userId) throw new AppError("validation", "Vous ne pouvez pas vous retirer vous-même.", 400);
    await repos.memberships.delete(tx, membershipId);
    await repos.sessions.deleteForUser(tx, m.userId);
    await tx.query("select set_config('app.org_id', $1, true)", [ctx.orgId]);
    await repos.audit.add(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "member.removed", targetType: "membership", targetId: membershipId, ip: ctx.ip });
  });
}

export async function deleteOrganization(ctx: OrgContext, confirmName: string): Promise<void> {
  requireAction(ctx, "data.delete");
  await ctx.services.db.withGlobal(async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    if (confirmName !== org.name) throw new AppError("validation", "Le nom saisi ne correspond pas.", 400);
    await repos.orgs.delete(tx, ctx.orgId);
  });
}

export async function exportAllData(ctx: OrgContext): Promise<Record<string, unknown>> {
  requireAction(ctx, "data.export");
  return withOrg(ctx, async (tx) => {
    const data = {
      exportedAt: ctx.services.now().toISOString(),
      mode: "connected",
      items: await repos.items.all(tx),
      customers: (await repos.customers.list(tx, { pageSize: 200 })).items,
      conversations: await tx.query("select * from conversations where org_id = $1", [ctx.orgId]),
      messages: await tx.query("select * from messages where org_id = $1", [ctx.orgId]),
      orders: await repos.orders.all(tx),
      rules: await repos.rules.list(tx),
      jobs: (await repos.jobs.list(tx, { pageSize: 200 })).items,
      searches: await repos.searches.list(tx),
      opportunities: await repos.opportunities.list(tx, {}),
      connections: (await repos.connections.list(tx)).map(({ hasSecret: _h, ...c }) => c),
      audit: await repos.audit.list(tx, 500),
    };
    await repos.usage.record(tx, "export.csv", { kind: "full_export" });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "data.exported", ip: ctx.ip });
    return data;
  });
}
