import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class FormEntityValueItemsACL extends BaseQueryACL<
  Prisma.FormEntityValueItemsWhereInput,
  Prisma.FormEntityValueItemsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getMutateWhere(): Promise<Prisma.FormEntityValueItemsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.FormEntityValueItemsUncheckedCreateInput): Promise<boolean> {
    const value = await this.prisma.formEntityValues.findFirst({
      where: { id: data.valueId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return value !== null
  }

  async getWhereClause(): Promise<Prisma.FormEntityValueItemsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }
}
