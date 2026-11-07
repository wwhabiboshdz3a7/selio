import { repos, type Db } from "@selio/db";
import { studio, wornPhotos, type Services, type WornRunSummary } from "@selio/core";
import type { TaskLogger } from "./tasks";

/**
 * Selio Studio côté worker.
 *
 * - « studio.worn » (toutes les 10 min) : photos portées dont l'heure est venue, DANS la fenêtre de nuit
 *   seulement (WORN_NIGHT_WINDOW, 22 h – 6 h Europe/Paris par défaut). Hors fenêtre, rien n'est lancé : seules
 *   les demandes restées « en cours » (worker interrompu) sont closes, quota rendu. Aucun fournisseur choisi
 *   (décision d'Ibrahim) : « noop » refuse chaque demande proprement (« aucun fournisseur configuré : décision
 *   à prendre »), place de quota rendue, dépassement jamais facturé.
 * - Rétention : brouillons de préparation jamais validés supprimés après 30 jours (ils ne contiennent que des
 *   clés de stockage et des champs, jamais d'image) ; demandes de photo portée terminées (produite, refusée, en
 *   échec) supprimées après 30 jours avec leurs objets du stockage (photo d'origine envoyée pour Studio, résultat),
 *   sauf un dépassement produit pas encore facturé. Une photo refusée ou en échec est effacée dès le passage de nuit.
 */

/** Demandes traitées au plus par passage (un fournisseur réel peut être lent ; le reste attend le passage suivant). */
export const STUDIO_WORN_BATCH = 20;

export interface StudioWornTickOptions {
  /** Arrêt du worker : plus aucune demande n'est prise (celle en cours se termine). */
  signal?: AbortSignal;
  limit?: number;
  now?: Date;
}

/** Passage des photos portées (file de nuit). Journalise seulement quand quelque chose a été fait. */
export async function studioWornTick(services: Services, log: TaskLogger, opts: StudioWornTickOptions = {}): Promise<WornRunSummary & { provider: string }> {
  const provider = services.wornPhotos?.name ?? "noop";
  const summary = await wornPhotos.runDueWornPhotos(services, { limit: opts.limit ?? STUDIO_WORN_BATCH, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.now ? { now: opts.now } : {}) });
  if (summary.done || summary.refused || summary.failed || summary.interrupted) {
    log.info({ name: "studio.worn", provider, ...summary }, provider === "noop" && summary.refused > 0 ? `photos portées : ${summary.refused} demande(s) refusée(s) — ${wornPhotos.NO_WORN_PROVIDER_MESSAGE}` : "photos portées : passage");
  }
  return { ...summary, provider };
}

async function allOrgIds(db: Db): Promise<string[]> {
  return (await db.withGlobal((tx) => repos.admin.orgSummary(tx))).map((o) => o.id);
}

export interface StudioRetentionSummary {
  orgs: number;
  /** Brouillons de préparation supprimés (jamais validés, plus de 30 jours). */
  preps: number;
  /** Demandes de photo portée terminées depuis plus de 30 jours supprimées. */
  worn: number;
  /** Objets du stockage effacés avec elles (photo d'origine de Studio, résultat). */
  objectsDeleted: number;
  errors: number;
}

/** Rétention de Studio : brouillons de préparation et demandes de photo portée de plus de 30 jours, organisation par organisation. */
export async function studioRetention(services: Services, log?: TaskLogger, now: Date = services.now()): Promise<StudioRetentionSummary> {
  const summary: StudioRetentionSummary = { orgs: 0, preps: 0, worn: 0, objectsDeleted: 0, errors: 0 };
  for (const orgId of await allOrgIds(services.db)) {
    try {
      summary.preps += await studio.purgeStalePreps(services, orgId, now);
      const worn = await wornPhotos.purgeFinishedWornPhotos(services, orgId, now);
      summary.worn += worn.jobs;
      summary.objectsDeleted += worn.objectsDeleted;
      if (worn.objectsFailed > 0) log?.warn({ orgId, objectsFailed: worn.objectsFailed }, "rétention studio : des objets du stockage n'ont pas pu être effacés");
      summary.orgs++;
    } catch (err) {
      summary.errors++;
      log?.error({ orgId, error: err instanceof Error ? err.name : "Error" }, "rétention studio : échec pour une organisation");
    }
  }
  if (summary.preps > 0 || summary.worn > 0) log?.info({ preps: summary.preps, worn: summary.worn, objectsDeleted: summary.objectsDeleted }, "rétention studio : brouillons de préparation et demandes de photo portée supprimés");
  return summary;
}
