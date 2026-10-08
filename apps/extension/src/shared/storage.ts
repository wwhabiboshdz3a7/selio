/** Stockage local de l'extension (jamais accessible aux pages web). */
export interface StoredConfig {
  apiBaseUrl: string | null;
  token: string | null;
  orgName: string | null;
  scopes: string[];
  lastPingAt: string | null;
  lastError: string | null;
  diagnostics: { url: string; pageKind: string; adapterVersion: string; ok: boolean; missing: string[]; warnings: string[]; at: string }[];
}

const DEFAULTS: StoredConfig = { apiBaseUrl: null, token: null, orgName: null, scopes: [], lastPingAt: null, lastError: null, diagnostics: [] };

export async function readConfig(): Promise<StoredConfig> {
  const raw = await chrome.storage.local.get("selio");
  return { ...DEFAULTS, ...((raw.selio as Partial<StoredConfig> | undefined) ?? {}) };
}

export async function writeConfig(patch: Partial<StoredConfig>): Promise<StoredConfig> {
  const current = await readConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ selio: next });
  return next;
}

export async function clearConfig(): Promise<void> {
  await chrome.storage.local.remove("selio");
}
