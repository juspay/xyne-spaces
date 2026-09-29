import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { appVisibilityWhere } from './app-scope-helper'

/**
 * Commands belong to an app template, so they inherit the app's org-level visibility rather than
 * the workspace scope BaseQueryACL would apply. Without this an install from a sibling workspace
 * succeeded but copied zero commands, leaving a bot with nothing behind its slash commands.
 */
export class AppCommandACL extends BaseQueryACL<
  Prisma.AppCommandWhereInput,
  Prisma.AppCommandUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AppCommandWhereInput> {
    return { app: { is: await appVisibilityWhere(this.prisma, this.ctx.workspaceId) } }
  }

  /** Editing the command set is editing the template — only the app's creator may do it. */
  async getMutateWhere(): Promise<Prisma.AppCommandWhereInput> {
    return {
      app: {
        is: {
          AND: [
            await appVisibilityWhere(this.prisma, this.ctx.workspaceId),
            { createdBy: this.ctx.userId },
          ],
        },
      },
    }
  }
}
