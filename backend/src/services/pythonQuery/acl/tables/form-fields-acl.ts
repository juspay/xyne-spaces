import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class FormFieldsACL extends BaseQueryACL<Prisma.FormFieldsWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormFieldsWhereInput> {
    // Simplified: formId → form.workspaceId (direct workspace check)
    const workspaceFormIds = (await this.prisma.form.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { id: true },
    })).map((f) => f.id)

    return { formId: { in: workspaceFormIds } }
  }
}
