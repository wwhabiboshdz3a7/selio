import { z } from "zod";

const optionalText = z.string().optional().default("");

const schema = z.object({
  VITE_API_BASE_URL: optionalText,
  VITE_SHOW_INDICATIVE_PRICING: z.enum(["true", "false"]).optional().default("true"),
  VITE_INVOICE_ISSUER_NAME: optionalText,
  VITE_INVOICE_ISSUER_ADDRESS: optionalText,
  VITE_INVOICE_ISSUER_SIREN: optionalText,
  VITE_INVOICE_ISSUER_VAT: optionalText,
  VITE_INVOICE_ISSUER_EMAIL: optionalText,
});

/** Configuration publique validée au démarrage (jamais de secret ici). */
export const env = schema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_SHOW_INDICATIVE_PRICING: import.meta.env.VITE_SHOW_INDICATIVE_PRICING,
  VITE_INVOICE_ISSUER_NAME: import.meta.env.VITE_INVOICE_ISSUER_NAME,
  VITE_INVOICE_ISSUER_ADDRESS: import.meta.env.VITE_INVOICE_ISSUER_ADDRESS,
  VITE_INVOICE_ISSUER_SIREN: import.meta.env.VITE_INVOICE_ISSUER_SIREN,
  VITE_INVOICE_ISSUER_VAT: import.meta.env.VITE_INVOICE_ISSUER_VAT,
  VITE_INVOICE_ISSUER_EMAIL: import.meta.env.VITE_INVOICE_ISSUER_EMAIL,
});

export const apiBaseUrl = env.VITE_API_BASE_URL.replace(/\/+$/, "");
/** Mode connecté disponible seulement si une API est configurée. */
export const connectedModeAvailable = apiBaseUrl !== "" || import.meta.env.DEV;
export const showIndicativePricing = env.VITE_SHOW_INDICATIVE_PRICING === "true";
export const appVersion = "0.1.0";
/** Identifiant de build (commit + date), affiché dans les rapports d'erreur. */
export const buildId: string = typeof __SELIO_BUILD__ === "string" ? __SELIO_BUILD__ : "dev";

/** Valeur affichée sur les factures tant qu'une mention légale n'est pas renseignée dans la configuration. */
export const ISSUER_PLACEHOLDER = "à compléter";

/**
 * Mentions de l'émetteur des factures (raison sociale, adresse, SIREN, TVA, contact), lues depuis la
 * configuration publique du site : rien n'est écrit en dur, et ce qui manque s'affiche « à compléter ».
 * Chaque champ dit s'il est renseigné, pour que la page puisse le signaler avant impression.
 */
export interface InvoiceIssuerConfig {
  name: string;
  /** Adresse postale, lignes séparées par « | » dans la variable (ex. « 12 rue … | 13001 Marseille »). */
  addressLines: string[];
  siren: string;
  vatNumber: string;
  email: string;
  /** Noms des champs encore à compléter (vides dans la configuration). */
  missing: ("address" | "siren" | "vatNumber" | "email")[];
}

export function invoiceIssuer(source: Pick<typeof env, "VITE_INVOICE_ISSUER_NAME" | "VITE_INVOICE_ISSUER_ADDRESS" | "VITE_INVOICE_ISSUER_SIREN" | "VITE_INVOICE_ISSUER_VAT" | "VITE_INVOICE_ISSUER_EMAIL"> = env): InvoiceIssuerConfig {
  const clean = (v: string) => v.trim();
  const address = clean(source.VITE_INVOICE_ISSUER_ADDRESS).split("|").map((l) => l.trim()).filter(Boolean);
  const siren = clean(source.VITE_INVOICE_ISSUER_SIREN);
  const vatNumber = clean(source.VITE_INVOICE_ISSUER_VAT);
  const email = clean(source.VITE_INVOICE_ISSUER_EMAIL);
  const missing: InvoiceIssuerConfig["missing"] = [];
  if (address.length === 0) missing.push("address");
  if (!siren) missing.push("siren");
  if (!vatNumber) missing.push("vatNumber");
  if (!email) missing.push("email");
  return {
    name: clean(source.VITE_INVOICE_ISSUER_NAME) || "Selio",
    addressLines: address.length ? address : [`Adresse ${ISSUER_PLACEHOLDER}`],
    siren: siren || ISSUER_PLACEHOLDER,
    vatNumber: vatNumber || ISSUER_PLACEHOLDER,
    email: email || ISSUER_PLACEHOLDER,
    missing,
  };
}
