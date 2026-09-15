import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Base for tables keyed by `orgId` rather than `workspaceId`. They carry no `workspaceId`
 * column, so they cannot inherit the workspace default; scope is the org(s) the caller is an
 * active member of, mirroring `OrganizationsACL`.
 *
 * With relationMode = "prisma" there is no relation to traverse, so the org ids are one query
 * on the base client, memoised for the life of the ACL instance (one per operation).
 */
abstract class OrgScopedACL<
  TWhereInput = Record<string, unknown>,
  TData = Record<string, unknown>,
> extends BaseQueryACL<TWhereInput, TData> {
  private cached?: string[]

  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  /** Org ids the caller is an active member of; `[]` when the caller has no member identity. */
  protected async callerOrgIds(): Promise<string[]> {
    if (this.cached) return this.cached
    if (!this.ctx.memberId) return (this.cached = [])
    const rows = await this.prisma.orgMember.findMany({
      where: { memberId: this.ctx.memberId, leftAt: null },
      select: { orgId: true },
    })
    return (this.cached = rows.map((r) => r.orgId))
  }

  /** `{ orgId: { in: [...] } }` — an empty list denies, which is the correct fail-closed default. */
  private async scope(): Promise<TWhereInput> {
    return { orgId: { in: await this.callerOrgIds() } } as unknown as TWhereInput
  }

  async getWhereClause(): Promise<TWhereInput> {
    return this.scope()
  }

  async getMutateWhere(): Promise<TWhereInput> {
    return this.scope()
  }
}

/** Verified email domains for an org. */
export class OrganizationDomainsACL extends OrgScopedACL<
  Prisma.OrganizationDomainWhereInput,
  Prisma.OrganizationDomainUncheckedCreateInput
> {}

/**
 * Encrypted LLM service-account credentials. Scoped by org membership.
 */
export class OrgLLMServiceAccountCredentialsACL extends OrgScopedACL<
  Prisma.OrgLLMServiceAccountCredentialWhereInput,
  Prisma.OrgLLMServiceAccountCredentialUncheckedCreateInput
> {
  hiddenFields(): string[] {
    return ['credentials']
  }
}
