import { userPreferences, userPreferencesUpdate, type UserPreferences } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, type Services } from "../context";

/**
 * Préférences de l'utilisateur connecté (raccourcis de Selio Manager), rangées sur sa ligne `users`
 * (0022_manager_journal.sql) : les mêmes sur téléphone et ordinateur. Une valeur illisible est ramenée au
 * défaut (jamais d'erreur à la lecture).
 */
export async function getPreferences(services: Services, userId: string): Promise<UserPreferences> {
  const raw = await services.db.withGlobal((tx) => repos.preferences.get(tx, userId));
  const parsed = userPreferences.safeParse(raw);
  return parsed.success ? parsed.data : userPreferences.parse({});
}

export async function updatePreferences(services: Services, userId: string, raw: unknown): Promise<UserPreferences> {
  const parsed = userPreferencesUpdate.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Préférences invalides", 400, parsed.error.flatten());
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  const saved = await services.db.withGlobal((tx) => repos.preferences.merge(tx, userId, patch));
  const out = userPreferences.safeParse(saved);
  return out.success ? out.data : userPreferences.parse({});
}
