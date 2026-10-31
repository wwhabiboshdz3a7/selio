/** Client HTTP minimal vers l'API Selio (service worker uniquement). */
export class ExtApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export async function apiRequest<T>(baseUrl: string, token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ExtApiError("network", "API Selio injoignable. Vérifiez l'URL dans les options et l'autorisation d'accès au site.", 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { throw new ExtApiError("internal", "Réponse illisible", res.status); }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ExtApiError(err?.code ?? "http", err?.message ?? `Erreur ${res.status}`, res.status);
  }
  return json as T;
}
