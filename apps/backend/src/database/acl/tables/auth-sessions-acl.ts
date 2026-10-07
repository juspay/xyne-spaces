import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * auth_sessions ACL — self-service only.
 *
 * The table has no workspaceId (one session spans every workspace of the account); the
 * principal is the OrgMember, so a caller sees and mutates exactly the sessions of their own
 * account. The resolver, issuer, revocation and push paths run before `req.user` exists and live
 * under src/bypassAcl/authSessionServices.ts.
 *
 * `tokenHash`, `deviceKey` and the push tokens are credentials and never leave the ACL path.
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
    return ['tokenHash', 'deviceKey', 'fcmToken', 'voipToken']
  }
}
