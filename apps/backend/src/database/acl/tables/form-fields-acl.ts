import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'

export class FormFieldsACL extends BaseQueryACL<
  Prisma.FormFieldsWhereInput,
  Prisma.FormFieldsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormFieldsWhereInput> {
    // Simplified: formId → form.workspaceId (direct workspace check)
    const workspaceFormIds = (await this.prisma.form.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })).map((f) => f.id)

    return { formId: { in: workspaceFormIds } }
  }

  async getMutateWhere(): Promise<Prisma.FormFieldsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.FormFieldsUncheckedCreateInput): Promise<boolean> {
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'FORMS')) {
      return true
    }
    const form = await this.prisma.form.findFirst({
      where: { id: data.formId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return form !== null
  }
}
