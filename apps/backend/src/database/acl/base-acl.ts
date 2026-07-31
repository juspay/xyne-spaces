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
 * The default allows everything; a table overrides only what it enforces:
 *   getWhereClause() — READ visibility: which rows may `ctx` see.
 *   getMutateWhere() — WRITE authorization: which rows may `ctx` update / delete.
 *   canCreate()      — CREATE authorization: may `ctx` insert this row? Mirrors the table's
 *                      Zero canInsert rule; default allow (create is unrestricted here).
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

  /** READ filter — rows `ctx` may see, or `null` for no restriction. */
  async getWhereClause(): Promise<TWhereInput | null> {
    return null
  }

  /** WRITE filter — rows `ctx` may update / delete, or `null` for no restriction. */
  async getMutateWhere(): Promise<TWhereInput | null> {
    return null
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
