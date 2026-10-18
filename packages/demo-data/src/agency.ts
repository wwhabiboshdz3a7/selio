/**
 * Selio Agence (aperçu) : boutiques clientes d'EXEMPLE, entièrement fictives.
 * Elles illustrent l'écran « Clients » et la facturation des clients ; aucune
 * n'existe, aucun chiffre n'est mesuré, rien n'est encaissé. L'interface les
 * marque toujours « Exemple fictif ».
 */
export type AgencyClientKind = "depot" | "reseller" | "team";
export type AgencyClientStatus = "active" | "onboarding" | "invited";

export interface AgencyClientExample {
  id: string;
  name: string;
  kind: AgencyClientKind;
  city: string;
  contact: string;
  /** Comptes Vinted gérés pour ce client. */
  accounts: number;
  listed: number;
  salesThisMonth: number;
  revenueCents: number;
  marginCents: number;
  /** Note moyenne des annonces en ligne (dressing), sur 100. */
  averageScore: number;
  status: AgencyClientStatus;
  /** Facturation imaginée par l'agence : forfait mensuel + commission sur les ventes. */
  monthlyFeeCents: number;
  commissionRate: number;
}

export const AGENCY_CLIENT_KIND_LABELS: Record<AgencyClientKind, string> = {
  depot: "Dépôt-vente",
  reseller: "Revendeuse indépendante",
  team: "Équipe de revendeurs",
};

export const AGENCY_CLIENT_STATUS_LABELS: Record<AgencyClientStatus, string> = {
  active: "Suivie",
  onboarding: "En démarrage",
  invited: "Invitation envoyée",
};

export const AGENCY_EXAMPLE_CLIENTS: readonly AgencyClientExample[] = [
  { id: "ag-1", name: "Dépôt-vente des Arcades", kind: "depot", city: "Lyon", contact: "Sophie G.", accounts: 2, listed: 184, salesThisMonth: 61, revenueCents: 1_372_000, marginCents: 412_000, averageScore: 71, status: "active", monthlyFeeCents: 9_900, commissionRate: 0.05 },
  { id: "ag-2", name: "Friperie Volt", kind: "team", city: "Lille", contact: "Yanis B.", accounts: 3, listed: 263, salesThisMonth: 88, revenueCents: 1_904_000, marginCents: 698_000, averageScore: 64, status: "active", monthlyFeeCents: 14_900, commissionRate: 0.04 },
  { id: "ag-3", name: "Clara R.", kind: "reseller", city: "Nantes", contact: "Clara R.", accounts: 1, listed: 57, salesThisMonth: 19, revenueCents: 418_000, marginCents: 171_000, averageScore: 78, status: "active", monthlyFeeCents: 3_900, commissionRate: 0 },
  { id: "ag-4", name: "Atelier Mode Circulaire", kind: "depot", city: "Bordeaux", contact: "Hélène M.", accounts: 1, listed: 32, salesThisMonth: 4, revenueCents: 96_000, marginCents: 27_000, averageScore: 52, status: "onboarding", monthlyFeeCents: 9_900, commissionRate: 0.05 },
  { id: "ag-5", name: "Collectif Seconde Vie", kind: "team", city: "Marseille", contact: "Inès T.", accounts: 0, listed: 0, salesThisMonth: 0, revenueCents: 0, marginCents: 0, averageScore: 0, status: "invited", monthlyFeeCents: 14_900, commissionRate: 0.04 },
];
