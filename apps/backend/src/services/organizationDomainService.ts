import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { config } from '@/config/env';
import { extractEmailDomain, isDomainAllowlisted, isEmailDomainAllowed } from '@/services/emailDomainPolicy';
import { OrganizationDomainVerificationStatus, Status, WorkspaceType } from '@xyne/shared';

const MATCHABLE_DOMAIN_STATUSES = [
  OrganizationDomainVerificationStatus.PENDING,
  OrganizationDomainVerificationStatus.VERIFIED,
  OrganizationDomainVerificationStatus.UNVERIFIED,
];

export interface ExistingOrganizationForDomain {
  orgId: string;
  name: string;
  description: string | null;
  domain: string;
  verificationStatus: string;
}

export interface ExistingEnterpriseWorkspaceForDomain extends ExistingOrganizationForDomain {
  workspaces: Array<{
    id: string;
    name: string;
  }>;
}

export class OrganizationDomainConflictError extends Error {
  readonly code = 'ORGANIZATION_DOMAIN_EXISTS';
  readonly statusCode = 409;

  constructor(
    readonly domain: string,
    readonly existingOrg: ExistingOrganizationForDomain,
  ) {
    super(
      `An organization already exists for ${domain}: ${existingOrg.name}. Ask an organization admin to invite you instead.`
    );
    this.name = 'OrganizationDomainConflictError';
  }
}

export class OrgMemberLimitError extends Error {
  readonly code = 'ORG_MEMBER_LIMIT_REACHED';
  readonly statusCode = 409;

  constructor(readonly orgId: string, readonly limit: number) {
    super(`This organization has reached the ${limit} user limit.`);
    this.name = 'OrgMemberLimitError';
  }
}

export class EmailDomainNotAllowedError extends Error {
  readonly code = 'EMAIL_DOMAIN_NOT_ALLOWED';
  readonly statusCode = 403;

  constructor(readonly domain: string | null) {
    super(`This email domain${domain ? ` (${domain})` : ''} is not allowed.`);
    this.name = 'EmailDomainNotAllowedError';
  }
}

export function isOrganizationPolicyError(
  error: unknown,
): error is OrganizationDomainConflictError | OrgMemberLimitError | EmailDomainNotAllowedError {
  return (
    error instanceof OrganizationDomainConflictError ||
    error instanceof OrgMemberLimitError ||
    error instanceof EmailDomainNotAllowedError
  );
}

export class OrganizationDomainService {
  private prisma: PrismaClient;
  private readonly orgMemberLimit = config.orgMemberLimit;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  extractEmailDomain(email: string): string | null {
    return extractEmailDomain(email);
  }

  /** Only allowlisted domains are ever matched to, or mapped onto, an organization. */
  shouldLookupDomain(email: string): boolean {
    return isDomainAllowlisted(this.extractEmailDomain(email));
  }

  async assertCanCreateOrgForEmail(email: string): Promise<void> {
    if (!isEmailDomainAllowed(email)) {
      throw new EmailDomainNotAllowedError(this.extractEmailDomain(email));
    }

    const existingOrg = await this.findExistingOrgByEmailDomain(email);
    if (existingOrg) {
      throw new OrganizationDomainConflictError(existingOrg.domain, existingOrg);
    }
  }

  async findExistingOrgByEmailDomain(email: string): Promise<ExistingOrganizationForDomain | null> {
    const domain = this.extractEmailDomain(email);
    if (!domain || !this.shouldLookupDomain(email)) {
      return null;
    }

    const mappings = await this.prisma.organizationDomain.findMany({
      where: {
        domain,
        verificationStatus: { in: MATCHABLE_DOMAIN_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (mappings.length === 0) {
      return null;
    }

    const activeOrgs = await this.prisma.organization.findMany({
      where: {
        orgId: { in: mappings.map(mapping => mapping.orgId) },
        status: Status.ACTIVE,
      },
      select: {
        orgId: true,
        name: true,
        description: true,
      },
    });

    const activeOrgById = new Map(activeOrgs.map(org => [org.orgId, org]));

    for (const mapping of mappings) {
      const organization = activeOrgById.get(mapping.orgId);
      if (organization) {
        return {
          ...organization,
          domain: mapping.domain,
          verificationStatus: mapping.verificationStatus,
        };
      }
    }

    return null;
  }

  async findEnterpriseWorkspaceByEmailDomain(
    email: string,
  ): Promise<ExistingEnterpriseWorkspaceForDomain | null> {
    const existingOrg = await this.findExistingOrgByEmailDomain(email);
    if (!existingOrg) {
      return null;
    }

    const workspaces = await this.prisma.workspace.findMany({
      where: {
        orgId: existingOrg.orgId,
        status: Status.ACTIVE,
        OR: [{ workspaceType: WorkspaceType.ENTERPRISE }, { workspaceType: null }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    });

    if (workspaces.length === 0) {
      return null;
    }

    return {
      ...existingOrg,
      workspaces,
    };
  }

  async createDomainMappingForOrg(params: {
    orgId: string;
    email: string;
    verifiedByUserId?: string | null;
  }): Promise<void> {
    if (!this.shouldLookupDomain(params.email)) {
      return;
    }

    const domain = this.extractEmailDomain(params.email);
    if (!domain) {
      return;
    }

    const now = new Date();
    await this.prisma.organizationDomain.upsert({
      where: {
        orgId_domain: {
          orgId: params.orgId,
          domain,
        },
      },
      create: {
        id: randomUUID(),
        orgId: params.orgId,
        domain,
        verificationStatus: OrganizationDomainVerificationStatus.PENDING,
        verifiedAt: null,
        verifiedByUserId: params.verifiedByUserId ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        updatedAt: now,
        verifiedByUserId: params.verifiedByUserId ?? undefined,
      },
    });
  }

  async assertOrgMemberLimit(orgId: string, email?: string): Promise<void> {
    // Counts every seat in the org, not just the caller's own, so it runs above the caller's own scope.
    return withWorkspaceScope(async () => {
      if (this.orgMemberLimit === null) {
        return;
      }

      const normalizedEmail = email?.trim().toLowerCase();
      if (normalizedEmail) {
        const existingMember = await this.prisma.orgMember.findFirst({
          where: {
            orgId,
            email: normalizedEmail,
            leftAt: null,
          },
          select: { memberId: true },
        });

        if (existingMember) {
          return;
        }
      }

      const activeMemberCount = await this.prisma.orgMember.count({
        where: {
          orgId,
          leftAt: null,
        },
      });

      if (activeMemberCount >= this.orgMemberLimit) {
        throw new OrgMemberLimitError(orgId, this.orgMemberLimit);
      }
    });
  }
}

export const organizationDomainService = new OrganizationDomainService();
