import type { PriceFeatures } from "@selio/contracts";
import { loadPriceModel, predictPrice, type SerializedPriceModel } from "@selio/pricing";
import { pricing, type PriceModelLike, type PricePredictionLike, type PricingServices, type Services } from "@selio/core";

/**
 * Modèle de prix (§5.10) côté API : l'API n'entraîne jamais (le worker le fait chaque semaine) ; elle
 * charge le modèle ACTIF enregistré dans `price_models` au démarrage, puis le recharge toutes les heures,
 * pour Studio, Radar, Track et les comparables de l'extension. Sans modèle : comparables seuls, et
 * l'interface affiche « modèle non entraîné ».
 */

/** Rechargement du modèle actif : toutes les heures. */
export const PRICE_MODEL_REFRESH_MS = 3_600_000;

/** Modèle enregistré, vu par le cœur (prédiction sur le processeur). */
class StoredPriceModel implements PriceModelLike {
  constructor(private readonly model: SerializedPriceModel, readonly version: string, readonly synthetic: boolean, private readonly now: () => Date) {}

  predict(f: PriceFeatures): PricePredictionLike {
    const p = predictPrice(this.model, {
      brand: f.brand ?? null, category: f.category, subcategory: f.subcategory ?? null, size: f.size ?? null,
      material: f.material ?? null, color: f.color ?? null, condition: f.condition ?? null, photoCount: f.photoCount ?? null,
    }, { now: this.now() });
    return { p25: p.p25, p50: p.p50, p75: p.p75, delayDays: p.delayDays, confidence: p.confidence, dataOrigin: this.synthetic ? "demo" : p.dataOrigin ?? this.model.dataOrigin };
  }
}

/** Chargeur d'un modèle enregistré (vérifié par @selio/pricing ; lève une erreur s'il est invalide). */
export function loadStoredPriceModel(stored: { version: string; model: unknown; synthetic: boolean }, now: () => Date = () => new Date()): PriceModelLike {
  const model = loadPriceModel(stored.model);
  return new StoredPriceModel(model, stored.version, stored.synthetic || model.dataOrigin !== "real", now);
}

/** `services.pricing` de l'API : chargeur seulement, aucun entraîneur. */
export function createApiPricingServices(now: () => Date): PricingServices {
  return { model: null, loader: (stored) => loadStoredPriceModel(stored, now) };
}

export interface PriceModelRefreshLogger {
  info: (o: object, m: string) => void;
  warn: (o: object, m: string) => void;
}

/** Version du modèle actif, sans lire son JSON (rechargement horaire). */
async function activeVersion(services: Services): Promise<string | null> {
  const row = await services.db.withGlobal((tx) => tx.maybeOne<{ version: string }>("select version from price_models where status = 'active' limit 1"));
  return row?.version ?? null;
}

/**
 * Recharge le modèle actif (jamais bloquant : une erreur laisse le modèle déjà chargé en place). Le JSON
 * (environ 1 Mo pour 20 000 références) n'est relu que si la version active a changé. Rend la version
 * chargée, ou null sans modèle actif.
 */
export async function refreshPriceModel(services: Services, log?: PriceModelRefreshLogger): Promise<string | null> {
  const before = services.pricing?.model?.version ?? null;
  try {
    if (before !== null && (await activeVersion(services)) === before) return before;
    const active = await pricing.refreshActiveModel(services);
    const after = active?.version ?? null;
    if (after && after !== before) log?.info({ version: after, synthetic: active?.synthetic ?? false, references: active?.nReferences ?? 0 }, active?.synthetic ? "prix : modèle chargé (données de démonstration)" : "prix : modèle chargé");
    return after;
  } catch (err) {
    log?.warn({ error: err instanceof Error ? err.message.slice(0, 200) : "Error" }, "prix : modèle actif illisible, le modèle déjà chargé est gardé");
    return before;
  }
}

/** Rechargement périodique (minuterie non bloquante) ; rend la fonction d'arrêt. */
export function schedulePriceModelRefresh(services: Services, log: PriceModelRefreshLogger, everyMs = PRICE_MODEL_REFRESH_MS): () => void {
  const timer = setInterval(() => void refreshPriceModel(services, log), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
