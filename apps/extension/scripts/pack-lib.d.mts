// Types de pack-lib.mjs (utilisés par test/pack.test.ts).
export interface ChromeManifest {
  manifest_version: number;
  name: string;
  short_name?: string;
  description: string;
  version: string;
  icons?: Record<string, string>;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: { matches?: string[]; js?: string[]; all_frames?: boolean; run_at?: string }[];
  content_security_policy?: { extension_pages?: string };
  externally_connectable?: unknown;
  web_accessible_resources?: unknown[];
  [key: string]: unknown;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

export declare const CWS_LIMITS: { nameMax: number; shortNameMax: number; descriptionMax: number };
export declare const ALLOWED_PERMISSIONS: string[];
export declare const ALLOWED_CONTENT_HOSTS: string[];
export declare function isPackable(relPath: string): boolean;
export declare function storeManifest(manifest: ChromeManifest, options?: { apiOrigin?: string; allowLocalApi?: boolean }): ChromeManifest;
export declare function validateManifest(manifest: ChromeManifest): CheckResult;
export declare function inspectBundle(files: Iterable<[string, string]>): CheckResult;
export declare function crc32(buf: Uint8Array): number;
export declare function createZip(entries: { name: string; data: Buffer | Uint8Array }[]): Buffer;
