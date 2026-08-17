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

export interface OrgMembersPage {
  readonly rows: OrgMemberRow[];
  readonly total: number;
}

export interface OrgMembersQuery {
  readonly q?: string;
  readonly limit?: number;
  readonly offset?: number;
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

export interface ConnectedSurface {
  readonly id: string;
  readonly orgId: string;
  readonly surfaceId: string;
  readonly surfaceTenantId: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly config: Record<string, unknown> | null;
  readonly surface: {
    readonly id: string;
    readonly key: string;
    readonly identityMode: 'USER_ID' | 'ACCESS_TOKEN';
    readonly supportsUserResolution: boolean;
    readonly status: 'ACTIVE' | 'INACTIVE';
  };
}

export interface ServiceAccessToken {
  readonly id: string;
  readonly name: string | null;
  readonly prefix: string;
  readonly userId: string;
  readonly scopes?: readonly string[];
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface MintedServiceAccessToken extends ServiceAccessToken {
  readonly token: string;
}

export interface MintServiceAccessTokenInput {
  readonly name: string;
  readonly userId: string;
  readonly allowedAgentSlugs: readonly string[];
  readonly expiresAt?: string | null;
}
