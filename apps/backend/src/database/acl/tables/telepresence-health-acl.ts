import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Fleet-wide device health; reads are not tenant-scoped.
 */
abstract class UnscopedHealthACL<
  TWhereInput = Record<string, unknown>,
  TData = Record<string, unknown>,
> extends BaseQueryACL<TWhereInput, TData> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<TWhereInput> {
    return {} as TWhereInput
  }

  async getMutateWhere(): Promise<TWhereInput> {
    return {} as TWhereInput
  }
}

export class TelepresenceHealthLogACL extends UnscopedHealthACL<
  Prisma.TelepresenceHealthLogWhereInput,
  Prisma.TelepresenceHealthLogUncheckedCreateInput
> {}

export class TelepresenceHealthViewACL extends UnscopedHealthACL<
  Prisma.TelepresenceHealthViewWhereInput,
  Prisma.TelepresenceHealthViewUncheckedCreateInput
> {}
