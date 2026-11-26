import type { BetaStatus, Membership, Organization, Role, User } from "@selio/contracts";

export interface Session {
  mode: "connected";
  user: User;
  org: Organization;
  role: Role;
  memberships: (Membership & { orgName: string })[];
  /** Accès bêta de l'organisation (badge, rappels, écran de bienvenue, blocage), null sans bêta. */
  beta: BetaStatus | null;
}

/**
 * Options de facturation lues dans l'environnement (API et worker) : la franchise en base de
 * TVA (FRANCHISE_TVA=true → factures à 0 % avec la mention « TVA non applicable, art. 293 B du
 * CGI »), sinon 20 %. Les montants des offres viennent de PRICING (@selio/demo-data).
 */
export interface BillingOptions {
  franchiseTva: boolean;
  /**
   * Mode de paiement effectif (PAYMENT_MODE, voir `effectivePaymentMode`) : « simulated » = offre enregistrée
   * sans carte, aucune commande ni débit (API et worker) ; « revolut » (ou absent) = parcours Revolut.
   */
  paymentMode?: "revolut" | "simulated";
}
