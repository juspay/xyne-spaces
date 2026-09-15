import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class FormContextMappingsACL extends BaseQueryACL<
  Prisma.FormContextMappingWhereInput,
  Prisma.FormContextMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormContextMappingWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      return denyGuestWhere('id')
    }

      return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.FormContextMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.FormContextMappingUncheckedCreateInput): Promise<boolean> {
    const form = await this.prisma.form.findFirst({
      where: { id: data.formId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return form !== null
  }
}
