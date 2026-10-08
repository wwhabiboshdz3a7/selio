import { repos, type Db } from "@selio/db";
import { getConnector } from "@selio/connectors";
import { admin, automation, connections as connectionsService, radar, type OrgContext, type Services } from "@selio/core";

/** Contexte « système » : actions du worker, journalisées avec l'acteur `system`. */
export function systemContext(services: Services, orgId: string): OrgContext {
  return { services, orgId, userId: "system", role: "owner", isOperator: true, ip: null };
}

async function allOrgIds(db: Db): Promise<string[]> {
  return (await db.withGlobal((tx) => repos.admin.orgSummary(tx))).map((o) => o.id);
}

export interface TaskLogger { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void }

/** Évalue toutes les règles actives de toutes les organisations (respecte pause globale, horaires, limites, idempotence). */
export async function automationTick(services: Services, log: TaskLogger): Promise<{ orgs: number; rules: number; created: number }> {
  let rules = 0, created = 0;
  const orgIds = await allOrgIds(services.db);
  for (const orgId of orgIds) {
    const ctx = systemContext(services, orgId);
    try {
      const state = await services.db.withOrg(orgId, (tx) => repos.automationState.get(tx));
      if (state.globalPaused) continue;
      const list = (await services.db.withOrg(orgId, (tx) => repos.rules.list(tx))).filter((r) => r.enabled);
      for (const rule of list) {
        const res = await services.db.withOrg(orgId, (tx) => automation.runRuleTx(ctx, tx, rule));
        rules++;
        created += res.created;
      }
    } catch (err) {
      log.error({ err, orgId }, "automation tick : échec pour une organisation");
    }
  }
  return { orgs: orgIds.length, rules, created };
}

/** Exécute les tâches serveur échues (nouvelles tentatives comprises). */
export async function processJobs(services: Services, log: TaskLogger): Promise<number> {
  let n = 0;
  for (const orgId of await allOrgIds(services.db)) {
    try {
      n += await automation.processDueJobs(systemContext(services, orgId));
    } catch (err) {
      log.error({ err, orgId }, "jobs : échec de traitement");
    }
  }
  return n;
}

/** Synchronise les connexions dont le transport est serveur (simulateur uniquement aujourd'hui). */
export async function connectorSyncTick(services: Services, log: TaskLogger): Promise<number> {
  let n = 0;
  for (const orgId of await allOrgIds(services.db)) {
    const ctx = systemContext(services, orgId);
    const list = await services.db.withOrg(orgId, (tx) => repos.connections.list(tx));
    for (const c of list) {
      if (c.transport !== "simulator" && c.transport !== "server") continue;
      if (c.status !== "connected" && c.status !== "degraded") continue;
      if (!getConnector(c.provider).readConversations) continue;
      try {
        await connectionsService.syncConnection(ctx, c.id);
        n++;
      } catch (err) {
        log.warn({ err, orgId, connectionId: c.id }, "sync : échec");
      }
    }
  }
  return n;
}

export async function radarTick(services: Services, log: TaskLogger): Promise<number> {
  let n = 0;
  for (const orgId of await allOrgIds(services.db)) {
    const ctx = systemContext(services, orgId);
    for (const s of await services.db.withOrg(orgId, (tx) => repos.searches.list(tx))) {
      if (!s.enabled) continue;
      try {
        await radar.runSearch(ctx, s.id);
        n++;
      } catch (err) {
        log.warn({ err, orgId, searchId: s.id }, "radar : échec");
      }
    }
  }
  return n;
}

export const retentionTick = (services: Services) => admin.retentionCleanup(services);
