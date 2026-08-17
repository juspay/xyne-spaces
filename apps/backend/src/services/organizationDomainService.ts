import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { config } from '@/config/env';
import { OrganizationDomainVerificationStatus, Status, WorkspaceType } from '@xyne/shared';

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'proton.me',
]);

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

export class PublicEmailDomainError extends Error {
  readonly code = 'PUBLIC_EMAIL_DOMAIN_BLOCKED';
  readonly statusCode = 403;

  constructor(readonly domain: string) {
    super(
      `Public email domains (${domain}) cannot create enterprise workspaces. Please use your work email.`,
    );
    this.name = 'PublicEmailDomainError';
  }
}

export function isOrganizationPolicyError(
  error: unknown,
): error is OrganizationDomainConflictError | OrgMemberLimitError | PublicEmailDomainError {
  return (
    error instanceof OrganizationDomainConflictError ||
    error instanceof OrgMemberLimitError ||
    error instanceof PublicEmailDomainError
  );
}

export class OrganizationDomainService {
  private prisma: PrismaClient;
  private readonly orgMemberLimit = config.orgMemberLimit;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  extractEmailDomain(email: string): string | null {
    const normalizedEmail = email.trim().toLowerCase();
    const atIndex = normalizedEmail.lastIndexOf('@');
    if (atIndex < 0 || atIndex === normalizedEmail.length - 1) {
      return null;
    }
    return normalizedEmail.slice(atIndex + 1);
  }

  shouldLookupDomain(email: string): boolean {
    const domain = this.extractEmailDomain(email);
    return !!domain && !PERSONAL_EMAIL_DOMAINS.has(domain);
  }

  async assertCanCreateOrgForEmail(email: string): Promise<void> {
    const domain = this.extractEmailDomain(email);
    if (!domain) {
      return;
    }

    if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
      throw new PublicEmailDomainError(domain);
    }

    const existingOrg = await this.findExistingOrgByEmailDomain(email);
    if (existingOrg) {
      throw new OrganizationDomainConflictError(existingOrg.domain, existingOrg);
    }
  }

  async findExistingOrgByEmailDomain(email: string): Promise<ExistingOrganizationForDomain | null> {
    const domain = this.extractEmailDomain(email);
    if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) {
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
