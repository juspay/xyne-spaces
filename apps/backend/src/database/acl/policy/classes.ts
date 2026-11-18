import { PrismaClient } from '@prisma/client'
import type { ACLContext, BaseQueryACL, MutateOp } from '../base-acl'
import { DENY, PolicyACL, type PolicyOptions } from './policy-acl'
import type { ParentRule } from './parents'
import { callerOrgIds, hasResourceAdmin } from './roles'

/**
 * The eight access classes. Every table maps to one of these in the policy map (or to a small
 * subclass of one that adds a column rule). Each class sets read, write and create together, so
 * the three can't drift apart. Shared rules (guest deny, workspace check, masking) come from
 * PolicyACL.
 *
 * Who gets past these rules at all: only user requests run per-table ACLs. Jobs, webhooks and
 * other backend code act for the workspace with workspace scope alone, so a table being
 * "backend only" here never blocks the backend.
 */

type Where = Record<string, unknown>

// ── Self ───────────────────────────────────────────────────────────────────────

export interface SelfOptions extends PolicyOptions {
  /** Column naming the row's owner ('userId', 'senderId', 'orgMemberId', …). */
  owner: string
  /** Which caller id the owner column holds. Default 'userId'; org-level rows use 'memberId'. */
  ownerIs?: 'userId' | 'memberId'
  /** Who reads: only the owner (default), or every member (a directory row such as a profile). */
  read?: 'owner' | 'members'
  /** A workspace admin may delete (revoke) anyone's row, but never read or edit it. */
  adminRevoke?: boolean
  /** Set false for a table without a workspaceId column (e.g. org-level sessions). Default true. */
  workspaceScoped?: boolean
}

/** Rows that belong to one user. Only that user reads or writes them; admins can't read them. */
export class SelfACL extends PolicyACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly s: SelfOptions) {
    super(ctx, prisma, s)
  }

  private get ownerValue(): string | undefined {
    return this.s.ownerIs === 'memberId' ? this.ctx.memberId : this.me
  }

  private scope(extra: Where = {}): Where {
    return this.s.workspaceScoped === false ? extra : { workspaceId: this.ws, ...extra }
  }

  private own(): Where {
    const v = this.ownerValue
    return v ? this.scope({ [this.s.owner]: v }) : DENY
  }

  protected read(): Where {
    // A directory row (profile, presence) is visible to members; a guest still sees only their own.
    return this.s.read === 'members' && !this.isGuest() ? this.scope() : this.own()
  }

  protected write(op: MutateOp): Where {
    if (op === 'delete' && this.s.adminRevoke && this.isAdmin()) return this.scope()
    return this.own()
  }

  protected create(data: Record<string, unknown>): boolean {
    const v = this.ownerValue
    return v !== undefined && data[this.s.owner] === v
  }
}

// ── Secret ─────────────────────────────────────────────────────────────────────

export interface SecretOptions extends PolicyOptions {
  /** Owner column, for a credential one user set up. Omit for a shared workspace credential. */
  owner?: string
  /** Who reads the non-secret columns. Default: 'members' without an owner, else 'ownerOrAdmin'. */
  read?: 'members' | 'ownerOrAdmin'
}

/**
 * A shared workspace credential (an LLM key, a data-source password). Workspace admins write; the
 * owner too, when there is one. The columns in `hidden` are never returned to anyone.
 */
export class SecretACL extends PolicyACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly s: SecretOptions) {
    super(ctx, prisma, s)
  }

  private ownerOrAdmin(): Where {
    if (this.isAdmin()) return { workspaceId: this.ws }
    return this.s.owner ? { workspaceId: this.ws, [this.s.owner]: this.me } : DENY
  }

  protected read(): Where {
    const mode = this.s.read ?? (this.s.owner ? 'ownerOrAdmin' : 'members')
    return mode === 'members' ? { workspaceId: this.ws } : this.ownerOrAdmin()
  }

  protected write(): Where {
    return this.ownerOrAdmin()
  }

  protected create(data: Record<string, unknown>): boolean {
    return this.isAdmin() || (!!this.s.owner && data[this.s.owner] === this.me)
  }
}

// ── Admin ──────────────────────────────────────────────────────────────────────

export interface AdminWriteOptions extends PolicyOptions {
  /** Resource whose ADMIN grant also allows writes (ROLES, FORMS, LISTPROJECTS, …). */
  resource?: string
  /** Who reads. Default 'members'. */
  read?: 'members' | 'admins'
}

/** Settings, permissions and structure: members read, workspace or resource admins write. */
export class AdminWriteACL extends PolicyACL {
  private canWriteCache?: Promise<boolean>

  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly a: AdminWriteOptions = {}) {
    super(ctx, prisma, a)
  }

  protected canWrite(): Promise<boolean> {
    if (!this.canWriteCache) {
      this.canWriteCache = this.a.resource
        ? hasResourceAdmin(this.prisma, this.ctx, this.a.resource)
        : Promise.resolve(this.isAdmin())
    }
    return this.canWriteCache
  }

  protected async read(): Promise<Where> {
    if (this.a.read === 'admins' && !(await this.canWrite())) return DENY
    return { workspaceId: this.ws }
  }

  protected async write(): Promise<Where> {
    return (await this.canWrite()) ? { workspaceId: this.ws } : DENY
  }

  protected create(): Promise<boolean> {
    return this.canWrite()
  }
}

// ── Org ────────────────────────────────────────────────────────────────────────

export interface OrgOptions extends PolicyOptions {
  /** Column holding the org id. Default 'orgId'. */
  orgField?: string
  /** Who reads. Default 'members' (members of that org). */
  read?: 'members' | 'admins'
}

/** Organisation-level rows: members of the org read, its OWNER/ADMIN write, only for their own org. */
export class OrgACL extends PolicyACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly o: OrgOptions = {}) {
    super(ctx, prisma, o)
  }

  private get field(): string {
    return this.o.orgField ?? 'orgId'
  }

  private async inOrgs(adminOnly: boolean): Promise<Where> {
    return { [this.field]: { in: await callerOrgIds(this.prisma, this.ctx, { adminOnly }) } }
  }

  protected read(): Promise<Where> {
    return this.inOrgs(this.o.read === 'admins')
  }

  protected write(): Promise<Where> {
    return this.inOrgs(true)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    const orgId = data[this.field]
    if (typeof orgId !== 'string') return false
    return (await callerOrgIds(this.prisma, this.ctx, { adminOnly: true })).includes(orgId)
  }
}

// ── Member ─────────────────────────────────────────────────────────────────────

export interface MemberOptions extends PolicyOptions {
  /** Creator column. Without one, any member may edit (shared content with no owner). */
  creator?: string
  /** Resource whose ADMIN grant may also edit others' rows. Workspace admins always may. */
  adminResource?: string
}

/** Shared workspace content: every member reads, the creator or an admin edits. */
export class MemberACL extends PolicyACL {
  private adminCache?: Promise<boolean>

  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly m: MemberOptions = {}) {
    super(ctx, prisma, m)
  }

  private canEditAll(): Promise<boolean> {
    if (!this.adminCache) {
      this.adminCache = this.m.adminResource
        ? hasResourceAdmin(this.prisma, this.ctx, this.m.adminResource)
        : Promise.resolve(this.isAdmin())
    }
    return this.adminCache
  }

  protected read(): Where {
    return { workspaceId: this.ws }
  }

  protected async write(): Promise<Where> {
    if (!this.m.creator || (await this.canEditAll())) return { workspaceId: this.ws }
    return { workspaceId: this.ws, [this.m.creator]: this.me }
  }

  protected create(data: Record<string, unknown>): boolean {
    return !this.m.creator || data[this.m.creator] === this.me
  }
}

// ── Entity ─────────────────────────────────────────────────────────────────────

export interface EntityOptions extends PolicyOptions {
  parent: ParentRule
  /** Creator/sender column. New rows must name the caller; see `creatorOnlyWrites`. */
  creator?: string
  /** Only the creator may update or delete (a message's sender). Default false. */
  creatorOnlyWrites?: boolean
  /**
   * Who may write rows under a parent: those who may write the parent (default), or everyone who
   * may read it (call chat, recordings: any participant adds rows without editing the call).
   */
  writeVia?: 'write' | 'read'
}

/**
 * Rows that belong to a parent (channel, ticket, canvas, call). Read and write both come from the
 * parent's own policy, so a user can never change a row they can't see.
 */
export class EntityACL extends PolicyACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly e: EntityOptions) {
    super(ctx, prisma, e)
  }

  protected read(): Promise<Where> {
    return this.e.parent.read(this.ctx, this.prisma)
  }

  protected async write(op: MutateOp): Promise<Where> {
    const viaParent =
      this.e.writeVia === 'read'
        ? await this.e.parent.read(this.ctx, this.prisma)
        : await this.e.parent.write(this.ctx, this.prisma, op)
    if (this.e.creator && this.e.creatorOnlyWrites) return { AND: [viaParent, { [this.e.creator]: this.me }] }
    return viaParent
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    if (this.e.creator && data[this.e.creator] !== this.me) return false
    return this.e.parent.canCreateUnder(this.ctx, this.prisma, data, this.e.writeVia ?? 'write')
  }
}

// ── System ─────────────────────────────────────────────────────────────────────

export interface SystemWriteOptions extends PolicyOptions {
  /** Who reads: through a parent, every member, workspace admins, or nobody. Default 'members'. */
  read?: ParentRule | 'members' | 'admins' | 'none'
  /**
   * The one insert a user request may make, when the row is part of the user's own action
   * (an audit entry naming the caller as actor, a connect group for a new entity). Default: none.
   */
  allowCreate?: (ctx: ACLContext, data: Record<string, unknown>) => boolean
}

/**
 * Written only by backend code (logs, stats, executions, sync state). A user request can never
 * create, update or delete these rows; backend code runs without per-table ACLs and is unaffected.
 */
export class SystemWriteACL extends PolicyACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, private readonly y: SystemWriteOptions = {}) {
    super(ctx, prisma, y)
  }

  protected async read(): Promise<Where> {
    const r = this.y.read ?? 'members'
    if (r === 'members') return { workspaceId: this.ws }
    if (r === 'admins') return this.isAdmin() ? { workspaceId: this.ws } : DENY
    if (r === 'none') return DENY
    return r.read(this.ctx, this.prisma)
  }

  protected write(): Where {
    return DENY
  }

  protected create(data: Record<string, unknown>): boolean {
    return this.y.allowCreate ? this.y.allowCreate(this.ctx, data) : false
  }
}

// ── Platform ───────────────────────────────────────────────────────────────────

/** Global reference data shared by every tenant. Everyone reads; no tenant ever writes. */
export class PlatformACL extends PolicyACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, { guest: 'read', ...opts })
  }

  protected read(): Where {
    return {}
  }

  protected write(): Where {
    return DENY
  }

  protected create(): boolean {
    return false
  }
}

// ── Custom ─────────────────────────────────────────────────────────────────────

/**
 * A table whose rule is too specific for a generic class (Slack Connect reach, DM exclusion,
 * guest channel grants): its existing hand-written ACL supplies read, write, create and column
 * rules, and PolicyACL still applies the shared ones on top (guest deny unless opted in, the
 * workspace check, column masking).
 */
export class CustomACL extends PolicyACL {
  private readonly inner: BaseQueryACL

  constructor(
    ctx: ACLContext,
    prisma: PrismaClient,
    Inner: new (ctx: ACLContext, prisma: PrismaClient) => BaseQueryACL,
    opts: PolicyOptions = {},
  ) {
    super(ctx, prisma, opts)
    this.inner = new Inner(ctx, prisma)
  }

  protected async read(queryWhere?: Record<string, unknown>): Promise<Where | null> {
    return (await this.inner.getWhereClause(queryWhere)) as Where | null
  }

  protected async write(op: MutateOp, queryWhere?: Record<string, unknown>): Promise<Where | null> {
    return (await this.inner.getMutateWhere(queryWhere, op)) as Where | null
  }

  protected create(data: Record<string, unknown>): Promise<boolean> {
    return this.inner.canCreate(data)
  }

  protected allowUpdate(data: Record<string, unknown>, queryWhere?: Record<string, unknown>): Promise<boolean> {
    return this.inner.canUpdate(data, queryWhere)
  }

  hiddenFields(): string[] {
    return [...new Set([...super.hiddenFields(), ...this.inner.hiddenFields()])]
  }
}
