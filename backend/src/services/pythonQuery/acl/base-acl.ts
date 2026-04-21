import { PrismaClient } from '@prisma/client'

export interface ACLContext {
  userId: string
  workspaceId?: string
  role?: string
  orgRole?: string
  memberId?: string
}

export class BaseQueryACL<TWhereInput = Record<string, unknown>> {
  protected readonly ctx: ACLContext
  protected readonly prisma: PrismaClient

  constructor(ctx: ACLContext, prisma: PrismaClient) {
    this.ctx = ctx
    this.prisma = prisma
  }

  async getWhereClause(): Promise<TWhereInput | null> {
    return null
  }

  async applyToWhere(userWhere: TWhereInput | undefined): Promise<TWhereInput> {
    const aclWhere = await this.getWhereClause()

    if (!aclWhere) {
      return userWhere || ({} as TWhereInput)
    }

    if (!userWhere || Object.keys(userWhere).length === 0) {
      return aclWhere
    }

    return {
      AND: [userWhere, aclWhere],
    } as unknown as TWhereInput
  }
}
