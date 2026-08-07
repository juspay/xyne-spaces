import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SurfaceLinksACL extends BaseQueryACL<
  Prisma.SurfaceLinkWhereInput,
  Prisma.SurfaceLinkUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SurfaceLinkWhereInput> {
    // The row carries its own denormalized workspaceId, so scope on it directly. The previous
    // walk through conversation → message loaded every message in the workspace into memory
    // on each read, and it only covered message-sourced rows — sourceId is polymorphic
    // (messages/tickets/canvases), so this is both cheaper and broader.
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.SurfaceLinkWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.SurfaceLinkUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    return data.createdBy === this.ctx.userId
  }
}
