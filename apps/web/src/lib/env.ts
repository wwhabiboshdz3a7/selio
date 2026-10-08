import { z } from "zod";

const schema = z.object({
  VITE_API_BASE_URL: z.string().optional().default(""),
  VITE_SHOW_INDICATIVE_PRICING: z.enum(["true", "false"]).optional().default("true"),
});

/** Configuration publique validée au démarrage (jamais de secret ici). */
export const env = schema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_SHOW_INDICATIVE_PRICING: import.meta.env.VITE_SHOW_INDICATIVE_PRICING,
});

export const apiBaseUrl = env.VITE_API_BASE_URL.replace(/\/+$/, "");
/** Mode connecté disponible seulement si une API est configurée. */
export const connectedModeAvailable = apiBaseUrl !== "" || import.meta.env.DEV;
export const showIndicativePricing = env.VITE_SHOW_INDICATIVE_PRICING === "true";
export const appVersion = "0.1.0";
