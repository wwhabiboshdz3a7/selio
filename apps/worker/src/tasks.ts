import { repos, type Db } from "@selio/db";
import { getConnector } from "@selio/connectors";
import { admin, automation, billing, cloud, connections as connectionsService, radar, type OrgContext, type Services } from "@selio/core";

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

/**
 * Rétention : messages, audit, requêtes IA et sessions expirées selon les réglages de chaque
 * organisation ; journal du Cloud gardé 90 jours, fenêtres de connexion expirées fermées, comptes
 * Cloud arrêtés (session effacée) quand l'offre ne comprend plus le Cloud. Selio Radar : mesures de
 * lecture (`radar_reads`) gardées 90 jours, affaires écartées supprimées après 30 jours, pseudo, note et
 * photo du vendeur effacés des autres affaires après 30 jours, alertes traitées gardées 90 jours.
 */
export async function retentionTick(services: Services, log?: TaskLogger) {
  const base = await admin.retentionCleanup(services);
  const cloudResult = await cloud.cloudMaintenance(services);
  const radarResult = { orgs: 0, reads: 0, deleted: 0, stripped: 0, alerts: 0, errors: 0 };
  for (const orgId of await allOrgIds(services.db)) {
    try {
      const r = await radar.purgeRadarData(services, orgId);
      radarResult.orgs++;
      radarResult.reads += r.reads;
      radarResult.deleted += r.deleted;
      radarResult.stripped += r.stripped;
      radarResult.alerts += r.alerts;
    } catch (err) {
      radarResult.errors++;
      log?.error({ orgId, error: err instanceof Error ? err.name : "Error" }, "rétention radar : échec pour une organisation");
    }
  }
  return { ...base, cloud: cloudResult, radar: radarResult };
}

export interface RenewalSummary {
  orgs: number;
  /** Débits réussis (période prolongée, facture émise). */
  renewed: number;
  /** Débits échoués : relance programmée (J+1, J+3, J+7 après l'échéance) et email envoyé. */
  failed: number;
  /** Retours à l'accès de base : essai terminé sans carte, résiliation échue, relances épuisées. */
  ended: number;
  /** Rien à faire (pas d'échéance, pas de fournisseur, commande en attente de webhook, fournisseur injoignable). */
  skipped: number;
  errors: number;
}

/**
 * Échéances d'abonnement (tâche horaire) : renouvellements à l'initiative du marchand avec le
 * moyen enregistré, fins d'essai, relances après échec (J+1, J+3, J+7 à l'heure de l'échéance),
 * résiliations arrivées à terme, autorisations de vérification à annuler. Chaque organisation est
 * traitée séparément : une erreur n'empêche pas les autres. Sans fournisseur de paiement configuré,
 * seules les fins d'essai sans carte sont appliquées.
 */
export async function renewSubscriptions(services: Services, log: TaskLogger): Promise<RenewalSummary> {
  const summary: RenewalSummary = { orgs: 0, renewed: 0, failed: 0, ended: 0, skipped: 0, errors: 0 };
  for (const orgId of await allOrgIds(services.db)) {
    summary.orgs++;
    try {
      const r = await billing.processSubscriptionRenewal(services, orgId);
      if (r.action === "renewed") summary.renewed++;
      else if (r.action === "failed") summary.failed++;
      else if (r.action === "ended" || r.action === "trial_ended") summary.ended++;
      else summary.skipped++;
      if (r.action !== "skipped") log.info({ orgId, action: r.action, reason: r.reason, invoiceNumber: r.invoiceNumber, nextChargeAt: r.nextChargeAt }, "échéance d'abonnement");
    } catch (err) {
      summary.errors++;
      log.error({ err, orgId }, "échéance d'abonnement : échec pour une organisation");
    }
  }
  return summary;
}
