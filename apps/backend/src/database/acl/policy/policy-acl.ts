import { PrismaClient } from '@prisma/client'
import { BaseQueryACL, isOwnWorkspace, type ACLContext, type MutateOp } from '../base-acl'
import { isGuest, isWorkspaceAdmin } from './roles'

/**
 * A where clause that matches no row on any model: Prisma treats an empty `OR` as false.
 * Used wherever a policy refuses outright, so a refusal is a filter (reads return nothing,
 * writes find no target) rather than a model-specific sentinel value.
 */
export const DENY = Object.freeze({ OR: [] as never[] }) as unknown as Record<string, unknown>

/** What a guest may do on a table. Guests are denied every table unless it says otherwise. */
export type GuestAccess = 'none' | 'read' | 'write'

export interface PolicyOptions {
  /** Columns never returned to a user request (column masking). Backend code still reads them. */
  hidden?: string[]
  /** Default 'none': a GUEST reads and writes nothing on this table. */
  guest?: GuestAccess
}

type Where = Record<string, unknown>

/**
 * Shared base for every policy class. It implements the hooks the ACL extension calls, applies
 * the rules every table needs, and asks the subclass only for what differs between tables:
 *
 *   read()          rows the caller may see
 *   write(op)       rows the caller may update or delete
 *   create(data)    may the caller insert this row?
 *   allowUpdate()   optional column rules on an update payload
 *
 * Rules applied here, for every table, so no table can forget them:
 *   - GUEST is denied unless the table opts in with `guest: 'read' | 'write'`.
 *   - An insert naming another workspace is refused.
 *   - Columns in `hidden` are stripped from results by the extension (via hiddenFields()).
 * A `workspaceId` change on update is refused by the extension for every table, policy or not.
 */
export abstract class PolicyACL<TWhere = Where, TData = Record<string, unknown>> extends BaseQueryACL<
  TWhere,
  TData
> {
  constructor(
    ctx: ACLContext,
    prisma: PrismaClient,
    protected readonly opts: PolicyOptions = {},
  ) {
    super(ctx, prisma)
  }

  // ── what a policy class defines ─────────────────────────────────────────────

  /** `queryWhere` is the caller's own where; most classes ignore it (Slack Connect canvas children use it). */
  // `null` = no opinion: the extension falls back to plain workspace scope.
  protected abstract read(queryWhere?: Record<string, unknown>): Promise<Where | null> | Where | null
  protected abstract write(op: MutateOp, queryWhere?: Record<string, unknown>): Promise<Where | null> | Where | null
  protected abstract create(data: Record<string, unknown>): Promise<boolean> | boolean

  /** Column rules for an update payload. Default: any column the row filter allows. */
  protected allowUpdate(
    _data: Record<string, unknown>,
    _queryWhere?: Record<string, unknown>,
  ): Promise<boolean> | boolean {
    return true
  }

  // ── helpers for subclasses ──────────────────────────────────────────────────

  protected get me(): string {
    return this.ctx.userId
  }

  protected get ws(): string {
    return this.ctx.workspaceId
  }

  protected isAdmin(): boolean {
    return isWorkspaceAdmin(this.ctx)
  }

  protected isGuest(): boolean {
    return isGuest(this.ctx)
  }

  /** True when the caller is a guest and this table doesn't give guests `need`. */
  protected guestBlocked(need: 'read' | 'write'): boolean {
    if (!this.isGuest()) return false
    const g = this.opts.guest ?? 'none'
    return !(g === 'write' || (g === 'read' && need === 'read'))
  }

  // ── the hooks the extension calls ───────────────────────────────────────────

  async getWhereClause(queryWhere?: Record<string, unknown>): Promise<TWhere | null> {
    if (this.guestBlocked('read')) return DENY as unknown as TWhere
    return (await this.read(queryWhere)) as unknown as TWhere
  }

  async getMutateWhere(queryWhere?: Record<string, unknown>, op: MutateOp = 'update'): Promise<TWhere | null> {
    if (this.guestBlocked('write')) return DENY as unknown as TWhere
    return (await this.write(op, queryWhere)) as unknown as TWhere
  }

  async canCreate(data: TData): Promise<boolean> {
    if (!isOwnWorkspace(data, this.ws)) return false
    if (this.guestBlocked('write')) return false
    return this.create((data ?? {}) as Record<string, unknown>)
  }

  async canUpdate(data: Record<string, unknown>, queryWhere?: Record<string, unknown>): Promise<boolean> {
    if (this.guestBlocked('write')) return false
    return this.allowUpdate(data ?? {}, queryWhere)
  }

  hiddenFields(): string[] {
    return this.opts.hidden ?? []
  }
}
