import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class FormContextMappingsACL extends BaseQueryACL<
  Prisma.FormContextMappingWhereInput,
  Prisma.FormContextMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormContextMappingWhereInput> {
    // Simplified: formId → form.workspaceId (direct workspace check)
    const workspaceFormIds = (await this.prisma.form.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })).map((f) => f.id)

    return { formId: { in: workspaceFormIds } }
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
