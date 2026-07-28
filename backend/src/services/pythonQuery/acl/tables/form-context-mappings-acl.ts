import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class FormContextMappingsACL extends BaseQueryACL<Prisma.FormContextMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormContextMappingWhereInput> {
    if (isGuestContext(this.ctx)) {
      return denyGuestWhere('id')
    }

    // Simplified: formId → form.workspaceId (direct workspace check)
    const workspaceFormIds = (await this.prisma.form.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { id: true },
    })).map((f) => f.id)

    return { formId: { in: workspaceFormIds } }
  }
}
