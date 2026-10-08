import type { Membership, Organization, Role, User } from "@selio/contracts";

export interface Session {
  mode: "connected";
  user: User;
  org: Organization;
  role: Role;
  memberships: (Membership & { orgName: string })[];
}
