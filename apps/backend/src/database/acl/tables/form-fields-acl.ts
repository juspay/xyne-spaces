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
    // Form definitions are workspace-scoped for guests too; guests need them to fill ticket fields.
      return { workspaceId: this.ctx.workspaceId }
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
