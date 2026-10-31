import { z } from "zod";

/** Booléen d'environnement ; accepte aussi un vrai booléen (environnement déjà parsé par l'API). */
const bool = (def: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? def : typeof v === "boolean" ? v : v === "true" || v === "1"));

/**
 * Stockage objet compatible S3 (MinIO sur notre machine, ou tout autre
 * service S3). Toutes les variables sont facultatives : sans
 * `STORAGE_ENDPOINT`, le stockage est « non configuré » et les routes de
 * téléversement répondent 503 `storage_unconfigured`.
 */
export const storageConfigSchema = z.object({
  /** Adresse du service S3 (ex. http://127.0.0.1:9000 pour MinIO en local). Vide = stockage désactivé. */
  STORAGE_ENDPOINT: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** Région signée. MinIO accepte n'importe quelle valeur ; on nomme la nôtre d'après la machine de Marseille. */
  STORAGE_REGION: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : "fr-mrs-1")),
  /** Bucket des photos (un seul ; l'isolation se fait par préfixe `org/<orgId>/`). */
  STORAGE_BUCKET: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  STORAGE_ACCESS_KEY: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  STORAGE_SECRET_KEY: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** `true` : URL de la forme endpoint/bucket/clé (MinIO). `false` : bucket.endpoint/clé (S3 « virtual-hosted »). */
  STORAGE_FORCE_PATH_STYLE: bool(true),
  /** Durée de vie des URLs signées, en secondes (15 minutes par défaut ; une semaine au plus, limite S3). */
  STORAGE_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(900),
});

export type StorageEnv = z.infer<typeof storageConfigSchema>;

/** Configuration effective d'un stockage branché : toutes les valeurs sont présentes. */
export interface StorageConfig {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  presignTtlSeconds: number;
}

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Lit l'environnement. Renvoie `null` quand `STORAGE_ENDPOINT` est absent
 * (stockage non configuré, cas de la démo et des tests). Quand l'endpoint
 * est présent, tout le reste devient obligatoire : une configuration à
 * moitié remplie arrête le démarrage avec un message explicite.
 */
export function loadStorageConfig(env: Record<string, unknown> = process.env): StorageConfig | null {
  const parsed = storageConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration du stockage invalide : ${issues}`);
  }
  const cfg = parsed.data;
  if (!cfg.STORAGE_ENDPOINT) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(cfg.STORAGE_ENDPOINT);
  } catch {
    throw new Error("Configuration du stockage invalide : STORAGE_ENDPOINT doit être une URL (ex. http://127.0.0.1:9000).");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("Configuration du stockage invalide : STORAGE_ENDPOINT doit être en http ou https.");
  if (endpoint.search || endpoint.hash) throw new Error("Configuration du stockage invalide : STORAGE_ENDPOINT ne doit porter ni paramètres ni fragment.");
  const missing = (["STORAGE_BUCKET", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"] as const).filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Configuration du stockage invalide : STORAGE_ENDPOINT est défini mais ${missing.join(", ")} manque(nt).`);
  if (!BUCKET_RE.test(cfg.STORAGE_BUCKET!)) throw new Error("Configuration du stockage invalide : STORAGE_BUCKET doit faire 3 à 63 caractères (minuscules, chiffres, « - », « . »).");
  return {
    endpoint,
    region: cfg.STORAGE_REGION,
    bucket: cfg.STORAGE_BUCKET!,
    accessKey: cfg.STORAGE_ACCESS_KEY!,
    secretKey: cfg.STORAGE_SECRET_KEY!,
    forcePathStyle: cfg.STORAGE_FORCE_PATH_STYLE,
    presignTtlSeconds: cfg.STORAGE_PRESIGN_TTL_SECONDS,
  };
}
