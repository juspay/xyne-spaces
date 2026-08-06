import { PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Deliberately NOT workspace-scoped — only for tables that are cross-workspace by nature
 * (global reference data, org/team analytics). If a table has ANY tenant key, scope by it.
 *
 * Returns `{}`, not `null`: `null` means "no opinion" and the extension re-applies the
 * workspace default to it, so it cannot express "unscoped".
 */
export class UnscopedACL<
  TWhereInput = Record<string, unknown>,
  TData = Record<string, unknown>,
> extends BaseQueryACL<TWhereInput, TData> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<TWhereInput | null> {
    return {} as TWhereInput
  }

  async getMutateWhere(): Promise<TWhereInput | null> {
    return {} as TWhereInput
  }
}
