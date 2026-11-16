import { PrismaClient } from '@prisma/client'

/** Which kind of write `getMutateWhere` is gating. Upsert counts as an update. */
export type MutateOp = 'update' | 'delete'

/** Who is asking. Resolved from the request/context and handed to every table ACL. */
export interface ACLContext {
  userId: string
  workspaceId: string
  role?: string
  orgRole?: string
  memberId?: string
}

/**
 * The workspace a create payload names, as the scalar `workspaceId` or a
 * `workspace: { connect | connectOrCreate }` relation.
 *   undefined — names none (the stamper will fill the caller's workspace)
 *   null      — a deliberate row on a nullable column
 *   string    — that workspace id
 * A `workspace` relation whose id can't be read returns '' so it never matches a real id.
 */
export function namedWorkspaceId(row: unknown): string | null | undefined {
  if (!row || typeof row !== 'object') return undefined
  const r = row as Record<string, unknown>
  if (r.workspaceId !== undefined) {
    return typeof r.workspaceId === 'string' || r.workspaceId === null ? r.workspaceId : ''
  }
  const rel = r.workspace as
    | { connect?: { id?: unknown }; connectOrCreate?: { where?: { id?: unknown } } }
    | undefined
  if (!rel || typeof rel !== 'object') return undefined
  const id = rel.connect?.id ?? rel.connectOrCreate?.where?.id
  return typeof id === 'string' ? id : ''
}

/** True when a create payload names no workspace, a null one, or exactly `workspaceId`. */
export function isOwnWorkspace(row: unknown, workspaceId: string): boolean {
  const named = namedWorkspaceId(row)
  return named === undefined || named === null || named === workspaceId
}

/**
 * Per-table ACL — the Prisma counterpart to the Zero query/mutation ACLs.
 * A table overrides only the hooks it needs:
 *   getWhereClause() — READ visibility: which rows may `ctx` see.
 *   getMutateWhere() — WRITE authorization: which rows may `ctx` update / delete (told which).
 *   canUpdate()      — UPDATE payload authorization: may `ctx` write these columns?
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
   *
   * `queryWhere` is the caller's own `where` for this read (undefined for `findUnique`). Most ACLs
   * ignore it; Slack Connect canvas-child ACLs read the query's `connectId`/`canvasId` from it so a
   * single-entity read can authorize by that one connect group instead of a full reachable set.
   */
  async getWhereClause(_queryWhere?: Record<string, unknown>): Promise<TWhereInput | null> {
    return { workspaceId: this.ctx.workspaceId } as unknown as TWhereInput
  }

  /**
   * WRITE filter — rows `ctx` may update / delete. Same default as reads. `queryWhere` is the caller's
   * own `where` for this mutate (undefined for unique-by-id ops); canvas-child ACLs read its
   * `connectId`/`canvasId` to gate a single-entity write, like reads.
   */
  async getMutateWhere(
    _queryWhere?: Record<string, unknown>,
    _op: MutateOp = 'update',
  ): Promise<TWhereInput | null> {
    return { workspaceId: this.ctx.workspaceId } as unknown as TWhereInput
  }

  /**
   * UPDATE payload authorization — may `ctx` write these columns? Called with the `data` of
   * update / updateMany / updateManyAndReturn and the update branch of upsert, after the row
   * filter has passed. `true` = allow (default). Column rules ("you may update your own row but
   * not its `role`") live here. A `workspaceId` change is refused by the extension for every
   * table, so overrides don't need to check it.
   */
  async canUpdate(_data: Record<string, unknown>, _queryWhere?: Record<string, unknown>): Promise<boolean> {
    return true
  }

  /**
   * CREATE authorization — may `ctx` insert this row? The default allows a row that names no
   * workspace (the stamper fills the caller's) or the caller's own workspace, and refuses one
   * naming another workspace. Overrides that add their own rules should keep that check
   * (`isOwnWorkspace`); the ACL extension enforces it again regardless.
   */
  async canCreate(data: TData): Promise<boolean> {
    return isOwnWorkspace(data, this.ctx.workspaceId)
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
