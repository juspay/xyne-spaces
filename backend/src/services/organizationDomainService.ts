import { randomUUID } from 'crypto';
import { PrismaClient, Status } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { OrganizationDomainVerificationStatus } from '@xyne/shared';

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
  workspace: {
    id: string;
    name: string;
  };
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

    const mapping = await this.prisma.organizationDomain.findFirst({
      where: {
        domain,
        verificationStatus: { in: MATCHABLE_DOMAIN_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!mapping) {
      return null;
    }

    const organization = await this.prisma.organization.findFirst({
      where: {
        orgId: mapping.orgId,
        status: Status.ACTIVE,
      },
      select: {
        orgId: true,
        name: true,
        description: true,
      },
    });

    if (!organization) {
      return null;
    }

    return {
      ...organization,
      domain: mapping.domain,
      verificationStatus: mapping.verificationStatus,
    };
  }

  async findEnterpriseWorkspaceByEmailDomain(
    email: string,
  ): Promise<ExistingEnterpriseWorkspaceForDomain | null> {
    const existingOrg = await this.findExistingOrgByEmailDomain(email);
    if (!existingOrg) {
      return null;
    }

    const workspace = await this.prisma.workspace.findFirst({
      where: {
        orgId: existingOrg.orgId,
        status: Status.ACTIVE,
        OR: [{ workspaceType: 'ENTERPRISE' }, { workspaceType: null }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    });

    if (!workspace) {
      return null;
    }

    return {
      ...existingOrg,
      workspace,
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
  }
}

export const organizationDomainService = new OrganizationDomainService();
