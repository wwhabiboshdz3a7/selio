import type { Membership, Organization, Role, User } from "@selio/contracts";

export interface Session {
  mode: "connected";
  user: User;
  org: Organization;
  role: Role;
  memberships: (Membership & { orgName: string })[];
}

/**
 * Options de facturation lues dans l'environnement (API et worker) : la franchise en base de
 * TVA (FRANCHISE_TVA=true → factures à 0 % avec la mention « TVA non applicable, art. 293 B du
 * CGI »), sinon 20 %. Les montants des offres viennent de PRICING (@selio/demo-data).
 */
export interface BillingOptions {
  franchiseTva: boolean;
}
