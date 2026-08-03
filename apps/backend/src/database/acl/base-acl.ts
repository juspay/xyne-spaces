import { PrismaClient } from '@prisma/client'

/** Who is asking. Resolved from the request/context and handed to every table ACL. */
export interface ACLContext {
  userId: string
  workspaceId: string
  role?: string
  orgRole?: string
  memberId?: string
}

/**
 * Per-table ACL — the Prisma counterpart to the Zero query/mutation ACLs.
 * A table overrides only the hooks it needs:
 *   getWhereClause() — READ visibility: which rows may `ctx` see.
 *   getMutateWhere() — WRITE authorization: which rows may `ctx` update / delete.
 *   canCreate()      — CREATE authorization: may `ctx` insert this row? Mirrors the table's
 *                      Zero canInsert rule.
 *   hiddenFields()   — FIELD masking: columns stripped from read results for `ctx`; default none.
 */
export class BaseQueryACL<
  TWhereInput = Record<string, unknown>,
  TData = Record<string, unknown>,
> {
  constructor(
    protected readonly ctx: ACLContext,
    protected readonly prisma: PrismaClient,
  ) {}

  /**
   * READ filter — rows `ctx` may see. Defaults to the caller's workspace: "no opinion" must
   * mean scoped. A table that spans workspaces says so by extending `UnscopedACL`.
   *
   * Tables without a `workspaceId` column cannot inherit this (Prisma rejects the unknown
   * field), which forces them to declare what they scope by.
   */
  async getWhereClause(): Promise<TWhereInput | null> {
    return { workspaceId: this.ctx.workspaceId } as unknown as TWhereInput
  }

  /** WRITE filter — rows `ctx` may update / delete. Same default as reads. */
  async getMutateWhere(): Promise<TWhereInput | null> {
    return { workspaceId: this.ctx.workspaceId } as unknown as TWhereInput
  }

  /** CREATE authorization — may `ctx` insert this row? `true` = allow (default). */
  async canCreate(_data: TData): Promise<boolean> {
    return true
  }

  /** FIELD masking — column names to strip from read results for `ctx`; `[]` = none (default). */
  hiddenFields(): string[] {
    return []
  }

  /** AND the read ACL onto the caller's own `where`. */
  async applyToWhere(userWhere: TWhereInput | undefined): Promise<TWhereInput> {
    const aclWhere = await this.getWhereClause()
    if (!aclWhere) return userWhere ?? ({} as TWhereInput)
    if (!userWhere || Object.keys(userWhere).length === 0) return aclWhere
    return { AND: [userWhere, aclWhere] } as unknown as TWhereInput
  }
}
