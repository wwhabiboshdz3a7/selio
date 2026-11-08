import { repos, type Db } from "@selio/db";
import { getConnector } from "@selio/connectors";
import { quotasForPlan } from "@selio/contracts";
import { admin, automation, billing, cloud, connections as connectionsService, migration, pricing, radar, track, type OrgContext, type Services } from "@selio/core";
import { studioRetention } from "./studio";

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
 * Selio Track : historique selon le plan (3 mois en Pro, 12 en Agence, rien sans Track), instantanés
 * partagés selon le plan le plus long des organisations qui suivent l'empreinte, filtres au-delà du
 * quota coupés. Selio Studio : brouillons de préparation jamais validés supprimés après 30 jours.
 * Migration depuis un autre outil : texte collé et fichier RGPD effacés 7 jours après la conversion
 * (la correspondance reste ; les captures ne sont jamais stockées).
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
  const trackResult = await trackRetention(services, log);
  const studioResult = await studioRetention(services, log);
  let migrationInputs = 0;
  try {
    migrationInputs = await migration.purgeRawInputs(services);
  } catch (err) {
    log?.error({ error: err instanceof Error ? err.name : "Error" }, "rétention : purge des entrées de migration en échec");
  }
  return { ...base, cloud: cloudResult, radar: radarResult, track: trackResult, studio: studioResult, migration: { rawInputsPurged: migrationInputs } };
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

// ---------------------------------------------------------------- rétention

/**
 * Filtres au-delà du quota du plan (offre réduite, Track plus compris) : coupés, les plus récents d'abord,
 * pour que plus aucune page ne soit lue pour eux. Le client peut les retirer ou en réactiver dans le quota.
 */
export async function enforceTrackFilterQuota(services: Services, orgId: string): Promise<number> {
  return services.db.withOrg(orgId, async (tx) => {
    const quota = Math.max(0, ((await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free")).trackFiltersFollowed);
    const enabled = (await repos.trackFilters.list(tx)).filter((f) => f.enabled).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const over = enabled.slice(quota);
    for (const f of over) await repos.trackFilters.update(tx, f.id, { enabled: false });
    if (over.length > 0) await repos.audit.add(tx, { actorUserId: null, action: "track.filters_disabled_by_plan", targetType: "track_filter", meta: { count: over.length, quota } });
    return over.length;
  });
}

export interface TrackRetentionSummary {
  orgs: number;
  scans: number;
  photoSearches: number;
  filtersDisabled: number;
  snapshots: number;
  fingerprints: number;
  /** Références de prix effacées (plus de 24 mois). */
  references: number;
  errors: number;
}

/**
 * Rétention de Track selon le plan : filtres au-delà du quota coupés, scans et recherches par photo plus
 * anciens que l'historique du plan supprimés (tout, sans Track), puis instantanés partagés gardés selon le
 * plan le plus long parmi les organisations qui suivent l'empreinte (12 mois au plus), empreintes plus
 * suivies oubliées, et base de références de prix gardée 24 mois.
 */
export async function trackRetention(services: Services, log?: TaskLogger, now: Date = services.now()): Promise<TrackRetentionSummary> {
  const summary: TrackRetentionSummary = { orgs: 0, scans: 0, photoSearches: 0, filtersDisabled: 0, snapshots: 0, fingerprints: 0, references: 0, errors: 0 };
  for (const orgId of await track.trackOrgIds(services)) {
    try {
      summary.filtersDisabled += await enforceTrackFilterQuota(services, orgId);
      const r = await track.purgeTrackHistory(services, orgId, now);
      summary.orgs++;
      summary.scans += r.scans;
      summary.photoSearches += r.photoSearches;
    } catch (err) {
      summary.errors++;
      log?.error({ orgId, error: err instanceof Error ? err.name : "Error" }, "rétention track : échec pour une organisation");
    }
  }
  try {
    const s = await track.purgeTrackSnapshots(services, now);
    summary.snapshots = s.snapshots;
    summary.fingerprints = s.fingerprints;
  } catch (err) {
    summary.errors++;
    log?.error({ error: err instanceof Error ? err.name : "Error" }, "rétention track : instantanés partagés en échec");
  }
  try {
    summary.references = await pricing.purgeReferences(services, now);
  } catch (err) {
    summary.errors++;
    log?.error({ error: err instanceof Error ? err.name : "Error" }, "rétention : base de références de prix en échec");
  }
  if (summary.filtersDisabled > 0) log?.info({ filtersDisabled: summary.filtersDisabled }, "rétention track : filtres au-delà du quota du plan coupés");
  return summary;
}
