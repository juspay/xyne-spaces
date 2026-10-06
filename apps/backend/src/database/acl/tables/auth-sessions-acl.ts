import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * auth_sessions ACL — self-service only.
 *
 * The table has no workspaceId (an auth session spans workspaces); the principal is the
 * OrgMember, so a caller sees and mutates exactly the sessions of their own account.
 * Cross-account reads/writes (resolver, revocation on deactivation, backfill, cleanup)
 * live under src/bypassAcl/authSessionServices.ts.
 *
 * `tokenHash` and `deviceKey` are credentials-adjacent and never leave the ACL path.
 */
export class AuthSessionsACL extends BaseQueryACL<
  Prisma.AuthSessionWhereInput,
  Prisma.AuthSessionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AuthSessionWhereInput> {
    return { accountId: this.ctx.memberId ?? '__none__' }
  }

  async getMutateWhere(): Promise<Prisma.AuthSessionWhereInput> {
    return { accountId: this.ctx.memberId ?? '__none__' }
  }

  async canCreate(data: Prisma.AuthSessionUncheckedCreateInput): Promise<boolean> {
    return !!this.ctx.memberId && data.accountId === this.ctx.memberId
  }

  hiddenFields(): string[] {
    return ['tokenHash', 'deviceKey']
  }
}
