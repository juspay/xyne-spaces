import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class WorkflowExecutionsACL extends BaseQueryACL<Prisma.WorkflowExecutionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowExecutionWhereInput | null> {
    return null
  }
}
