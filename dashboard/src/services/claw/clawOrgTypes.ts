export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type AddableOrgRole = Exclude<OrgRole, 'OWNER'>;

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly role: OrgRole;
}

export interface OrgMemberRow {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrgRole;
  readonly joinedAt: string;
}

export interface OrgDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly members: OrgMemberRow[];
}

export interface ClawOrganization {
  readonly summary: OrgSummary;
  readonly detail: OrgDetail;
}
