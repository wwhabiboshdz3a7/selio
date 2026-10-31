import type { BackgroundResponse, ExtensionStatus, ToBackground, ToContent } from "./messages";

export function sendToBackground(msg: ToBackground): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res: BackgroundResponse) => {
      if (chrome.runtime.lastError) resolve({ ok: false, code: "runtime", message: chrome.runtime.lastError.message ?? "Erreur" });
      else resolve(res ?? { ok: false, code: "no_response", message: "Pas de réponse" });
    });
  });
}

export async function getStatus(): Promise<ExtensionStatus> {
  const res = await sendToBackground({ type: "status" });
  if (!res.ok) return { paired: false, apiBaseUrl: null, orgName: null, scopes: [], lastPingAt: null, lastError: res.message };
  return res.data as ExtensionStatus;
}

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export function sendToContent(tabId: number, msg: ToContent): Promise<{ ok: boolean; data?: unknown } | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res ?? null);
    });
  });
}
