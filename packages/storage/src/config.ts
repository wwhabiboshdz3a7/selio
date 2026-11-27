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
  /**
   * Stockage LOCAL (sans S3) : dossier où l'API écrit les photos (volume Docker partagé avec le worker).
   * Utilisé quand STORAGE_ENDPOINT est vide. Les photos passent alors par l'API (`/api/storage/…`), avec des
   * liens signés et datés comme en S3 : rien d'autre que l'API n'est ouvert sur Internet.
   */
  STORAGE_LOCAL_DIR: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** Adresse publique du site qui relaie /api/* vers l'API (ex. https://seliovprod.netlify.app) : base des liens signés. */
  STORAGE_PUBLIC_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
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
  /** Stockage local : dossier des photos et adresse publique (liens `/api/storage/…` signés par HMAC). */
  local?: { dir: string; publicUrl: URL };
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
  if (!cfg.STORAGE_ENDPOINT && cfg.STORAGE_LOCAL_DIR) return loadLocalStorageConfig(cfg);
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

/** Stockage local : dossier absolu, adresse publique http(s), clé de signature d'au moins 32 caractères. */
function loadLocalStorageConfig(cfg: StorageEnv): StorageConfig {
  const dir = cfg.STORAGE_LOCAL_DIR!;
  if (!dir.startsWith("/")) throw new Error("Configuration du stockage invalide : STORAGE_LOCAL_DIR doit être un chemin absolu (ex. /var/lib/selio-photos).");
  if (!cfg.STORAGE_PUBLIC_URL) throw new Error("Configuration du stockage invalide : STORAGE_LOCAL_DIR est défini mais STORAGE_PUBLIC_URL manque (adresse publique du site, ex. https://seliovprod.netlify.app).");
  let publicUrl: URL;
  try {
    publicUrl = new URL(cfg.STORAGE_PUBLIC_URL);
  } catch {
    throw new Error("Configuration du stockage invalide : STORAGE_PUBLIC_URL doit être une URL (ex. https://seliovprod.netlify.app).");
  }
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") throw new Error("Configuration du stockage invalide : STORAGE_PUBLIC_URL doit être en http ou https.");
  if (!cfg.STORAGE_SECRET_KEY || cfg.STORAGE_SECRET_KEY.length < 32) throw new Error("Configuration du stockage invalide : en stockage local, STORAGE_SECRET_KEY (clé de signature des liens) doit faire au moins 32 caractères.");
  const base = new URL(publicUrl.origin);
  return {
    endpoint: new URL("/api/storage/", base),
    region: cfg.STORAGE_REGION,
    bucket: "local",
    accessKey: "local",
    secretKey: cfg.STORAGE_SECRET_KEY,
    forcePathStyle: false,
    presignTtlSeconds: cfg.STORAGE_PRESIGN_TTL_SECONDS,
    local: { dir: dir.replace(/\/+$/, ""), publicUrl: base },
  };
}
