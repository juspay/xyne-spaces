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

  // Items are written only by formEntityValueRepository, in the same transaction as their
  // form_entity_values row, which has already passed its own ACL. That row isn't committed yet,
  // so it can't be looked up here (this.prisma is outside the transaction).
  async canCreate(data: Prisma.FormEntityValueItemsUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }

  async getWhereClause(): Promise<Prisma.FormEntityValueItemsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }
}
