import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client "admin" cote serveur uniquement (cle service_role). Ce fichier ne
// doit JAMAIS etre importe depuis du code qui tourne dans le navigateur.
// L'autorisation (qui a le droit de lire/ecrire quoi) est geree a la main
// dans chaque fonction, comme avec la premiere version (D1).
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes. Ajoute-les dans Netlify > Site configuration > Environment variables.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const STORAGE_BUCKET = "listings";

export function publicStorageUrl(path: string): string {
  const url = process.env.SUPABASE_URL;
  return `${url}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}
