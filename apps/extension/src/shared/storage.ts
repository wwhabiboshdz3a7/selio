/** Stockage local de l'extension (jamais accessible aux pages web). */
export interface StoredConfig {
  apiBaseUrl: string | null;
  token: string | null;
  orgName: string | null;
  scopes: string[];
  lastPingAt: string | null;
  lastError: string | null;
  diagnostics: { url: string; pageKind: string; adapterVersion: string; ok: boolean; missing: string[]; warnings: string[]; at: string }[];
  /**
   * Automatisation complète (D64), désactivée par défaut. Miroir local de l'interrupteur enregistré sur le
   * serveur (qui seul décide d'agir) et du dernier réveil (affiché dans le popup). Aucun texte de message.
   */
  auto: { enabled: boolean; connectionId: string | null; lastTickAt: string | null; lastOutcome: string | null; pausedLabel: string | null };
}

const AUTO_DEFAULTS: StoredConfig["auto"] = { enabled: false, connectionId: null, lastTickAt: null, lastOutcome: null, pausedLabel: null };
const DEFAULTS: StoredConfig = { apiBaseUrl: null, token: null, orgName: null, scopes: [], lastPingAt: null, lastError: null, diagnostics: [], auto: AUTO_DEFAULTS };

export async function readConfig(): Promise<StoredConfig> {
  const raw = await chrome.storage.local.get("selio");
  const stored = (raw.selio as Partial<StoredConfig> | undefined) ?? {};
  return { ...DEFAULTS, ...stored, auto: { ...AUTO_DEFAULTS, ...(stored.auto ?? {}) } };
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
