import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class FormEntityValuesACL extends BaseQueryACL<
  Prisma.FormEntityValuesWhereInput,
  Prisma.FormEntityValuesUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getMutateWhere(): Promise<Prisma.FormEntityValuesWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.FormEntityValuesUncheckedCreateInput): Promise<boolean> {
    const form = await this.prisma.form.findFirst({
      where: { id: data.formId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return form !== null
  }

  async getWhereClause(): Promise<Prisma.FormEntityValuesWhereInput> {
    // Scope on the row's own tenant key, matching the sync layer and getMutateWhere below.
    return { workspaceId: this.ctx.workspaceId }
  }
}
