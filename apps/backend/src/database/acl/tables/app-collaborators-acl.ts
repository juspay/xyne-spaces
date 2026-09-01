import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Collaborator rows are scoped by their own denormalized workspaceId, mirroring
 * AppsACL — reads stay inside the caller's workspace.
 *
 * Writes additionally require the caller to be the app's creator (implicit ADMIN) or an
 * ADMIN collaborator, which is the same rule the Zero app-collaborator mutators enforce.
 */
export class AppCollaboratorsACL extends BaseQueryACL<
  Prisma.AppCollaboratorWhereInput,
  Prisma.AppCollaboratorUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AppCollaboratorWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.AppCollaboratorWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      app: {
        OR: [
          { createdBy: this.ctx.userId },
          {
            collaborators: {
              some: { userId: this.ctx.userId, collaboratorType: 'ADMIN' },
            },
          },
        ],
      },
    }
  }
}
