import { PrismaClient } from '@prisma/client'
import type { ACLContext, BaseQueryACL } from '../base-acl'
import {
  AppsACL,
  CanvasParticipantsACL,
  ChannelParticipantsACL,
  MessagesACL,
  OrgMembersACL,
  ReactionsACL,
  UsersACL,
} from '../tables'
import { CustomACL, EntityACL } from './classes'
import { parent } from './parents'
import type { PolicyOptions } from './policy-acl'
import { callerOrgIds } from './roles'

/**
 * Tables that keep their existing rule (CustomACL) or a generic class, plus one extra column or
 * create rule the audit found missing. Each class is referenced from exactly one policy-map line.
 */

type Where = Record<string, unknown>
type Ctor = new (ctx: ACLContext, prisma: PrismaClient) => BaseQueryACL

/** True when the update payload touches any of `columns`. */
function touches(data: Record<string, unknown>, columns: string[]): boolean {
  return columns.some((c) => c in data)
}

/** The rows an update targets, for column rules that depend on the row (its channel, its canvas). */
async function targetRows<T>(
  prisma: PrismaClient,
  model: string,
  where: Where | undefined,
  select: Record<string, true>,
): Promise<T[]> {
  if (!where) return []
  const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<T[]> }>)[model]
  return delegate.findMany({ where, select, take: 500 })
}

// ── User ───────────────────────────────────────────────────────────────────────

const USER_ADMIN_COLUMNS = ['role', 'status', 'userType', 'workspaceId', 'orgMemberId', 'email', 'providerUserId']

/** Users: existing rule, plus only a workspace admin changes role, status, type or identity columns. */
export class UserPolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, UsersACL as unknown as Ctor, opts)
  }

  protected async allowUpdate(data: Record<string, unknown>, queryWhere?: Where): Promise<boolean> {
    if (touches(data, USER_ADMIN_COLUMNS) && !this.isAdmin()) return false
    return super.allowUpdate(data, queryWhere)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    // New users come from signup/invitation flows (backend). A user request may not create users
    // unless it is a workspace admin.
    if (!this.isAdmin()) return false
    return super.create(data)
  }
}

// ── OrgMember ──────────────────────────────────────────────────────────────────

const ORG_MEMBER_ADMIN_COLUMNS = ['role', 'orgId', 'email', 'passwordHash', 'memberId']

/** Org members: existing rule, plus role/identity changes and new members only by an admin of that org. */
export class OrgMemberPolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, OrgMembersACL as unknown as Ctor, opts)
  }

  private async adminOrgIds(): Promise<string[]> {
    return callerOrgIds(this.prisma, this.ctx, { adminOnly: true })
  }

  protected async allowUpdate(data: Record<string, unknown>, queryWhere?: Where): Promise<boolean> {
    if (touches(data, ORG_MEMBER_ADMIN_COLUMNS)) {
      const admin = await this.adminOrgIds()
      const rows = await targetRows<{ orgId: string }>(this.prisma, 'orgMember', queryWhere, { orgId: true })
      if (rows.length === 0 || rows.some((r) => !admin.includes(r.orgId))) return false
    }
    return super.allowUpdate(data, queryWhere)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    const orgId = data.orgId
    if (typeof orgId !== 'string' || !(await this.adminOrgIds()).includes(orgId)) return false
    return super.create(data)
  }
}

// ── ChannelParticipant ─────────────────────────────────────────────────────────

const CHANNEL_ADMIN = 'ADMIN'

/** Channel participants: existing rule, plus only a channel admin grants or changes roles. */
export class ChannelParticipantPolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, ChannelParticipantsACL as unknown as Ctor, opts)
  }

  /** Channels (of `channelIds`) where the caller is a channel ADMIN; all of them for a workspace admin. */
  private async adminOf(channelIds: string[]): Promise<Set<string>> {
    if (this.isAdmin()) return new Set(channelIds)
    const rows = await this.prisma.channelParticipant.findMany({
      where: { userId: this.me, role: CHANNEL_ADMIN, channelId: { in: channelIds }, workspaceId: this.ws },
      select: { channelId: true },
    })
    return new Set(rows.map((r) => r.channelId))
  }

  protected async allowUpdate(data: Record<string, unknown>, queryWhere?: Where): Promise<boolean> {
    // Changing anyone's role, including your own, takes a channel admin.
    if ('role' in data) {
      const rows = await targetRows<{ channelId: string }>(this.prisma, 'channelParticipant', queryWhere, { channelId: true })
      const ids = [...new Set(rows.map((r) => r.channelId))]
      const admin = await this.adminOf(ids)
      if (ids.length === 0 || ids.some((id) => !admin.has(id))) return false
    }
    return super.allowUpdate(data, queryWhere)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    if (data.role === CHANNEL_ADMIN) {
      const channelId = data.channelId
      if (typeof channelId !== 'string') return false
      // The channel's creator becomes its first ADMIN; the channel may not be visible yet when the
      // two are written together.
      const channel = await this.prisma.channel.findFirst({ where: { id: channelId }, select: { createdBy: true } })
      const creatorJoining = data.userId === this.me && (!channel || channel.createdBy === this.me)
      if (!creatorJoining && !(await this.adminOf([channelId])).has(channelId)) return false
    }
    return super.create(data)
  }
}

// ── CanvasParticipant ──────────────────────────────────────────────────────────

const CANVAS_RANK: Record<string, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 }

/**
 * Canvas participants: existing rule, plus only an OWNER or EDITOR adds or changes participants,
 * never to a role above their own.
 */
export class CanvasParticipantPolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, CanvasParticipantsACL as unknown as Ctor, opts)
  }

  /** The caller's own rank on each canvas (0 = none). Workspace admins rank as OWNER. */
  private async rankOn(canvasIds: string[]): Promise<Map<string, number>> {
    const out = new Map(canvasIds.map((id) => [id, this.isAdmin() ? CANVAS_RANK.OWNER : 0]))
    if (this.isAdmin()) return out
    const [mine, created] = await Promise.all([
      this.prisma.canvasParticipant.findMany({
        where: { userId: this.me, canvasId: { in: canvasIds } },
        select: { canvasId: true, role: true },
      }),
      this.prisma.canvas.findMany({
        where: { id: { in: canvasIds }, createdBy: this.me },
        select: { id: true },
      }),
    ])
    for (const r of mine) out.set(r.canvasId, Math.max(out.get(r.canvasId) ?? 0, CANVAS_RANK[r.role] ?? 0))
    for (const c of created) out.set(c.id, CANVAS_RANK.OWNER)
    return out
  }

  private async canGrant(canvasIds: string[], role: string | undefined): Promise<boolean> {
    const wanted = CANVAS_RANK[role ?? 'VIEWER'] ?? CANVAS_RANK.OWNER
    const ranks = await this.rankOn(canvasIds)
    return canvasIds.length > 0 && canvasIds.every((id) => {
      const mine = ranks.get(id) ?? 0
      return mine >= CANVAS_RANK.EDITOR && wanted <= mine
    })
  }

  protected async allowUpdate(data: Record<string, unknown>, queryWhere?: Where): Promise<boolean> {
    if ('role' in data) {
      const rows = await targetRows<{ canvasId: string }>(this.prisma, 'canvasParticipant', queryWhere, { canvasId: true })
      if (!(await this.canGrant([...new Set(rows.map((r) => r.canvasId))], data.role as string | undefined))) return false
    }
    return super.allowUpdate(data, queryWhere)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    const canvasId = data.canvasId
    if (typeof canvasId !== 'string') return false
    // A canvas and its OWNER row are created in one batch, so the canvas isn't visible yet: the
    // creator may add themself as OWNER of a canvas that doesn't exist yet.
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: canvasId, workspaceId: this.ws },
      select: { visibility: true },
    })
    if (!canvas) return data.userId === this.me && data.role === 'OWNER' && super.create(data)
    // Anyone may join a PUBLIC canvas themself, up to EDITOR (never OWNER).
    const role = (data.role as string | undefined) ?? 'VIEWER'
    if (canvas.visibility === 'PUBLIC' && data.userId === this.me && role !== 'OWNER') return super.create(data)
    // Otherwise an OWNER/EDITOR adds participants, at or below their own role.
    if (!(await this.canGrant([canvasId], data.role as string | undefined))) return false
    return super.create(data)
  }
}

// ── Message / Reaction ─────────────────────────────────────────────────────────

/** Is `userId` a bot of the caller's workspace? Bots post through backend code on a user's request. */
async function isWorkspaceBot(prisma: PrismaClient, ctx: ACLContext, userId: unknown): Promise<boolean> {
  if (typeof userId !== 'string') return false
  const u = await prisma.user.findFirst({
    where: { id: userId, workspaceId: ctx.workspaceId, userType: 'BOT' },
    select: { id: true },
  })
  return u !== null
}

/** Messages: existing rule, plus a new message's sender must be the caller (or a workspace bot). */
export class MessagePolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, MessagesACL as unknown as Ctor, opts)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    if (data.senderId !== this.me && !(await isWorkspaceBot(this.prisma, this.ctx, data.senderId))) return false
    return super.create(data)
  }
}

/** Reactions: existing rule, plus a reaction is always the caller's own. */
export class ReactionPolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, ReactionsACL as unknown as Ctor, opts)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    if (data.userId !== this.me) return false
    return super.create(data)
  }
}

// ── Apps ───────────────────────────────────────────────────────────────────────

/** Apps: existing rule, plus a new app belongs to the caller's org and is never GLOBAL. */
export class AppsPolicyACL extends CustomACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, AppsACL as unknown as Ctor, opts)
  }

  protected async create(data: Record<string, unknown>): Promise<boolean> {
    // GLOBAL (marketplace) apps are published by platform tooling, never from a tenant request.
    if (data.scope === 'GLOBAL') return false
    const orgId = data.orgId
    if (typeof orgId !== 'string' || !(await callerOrgIds(this.prisma, this.ctx)).includes(orgId)) return false
    if (data.createdBy !== undefined && data.createdBy !== this.me) return false
    return super.create(data)
  }

  protected async allowUpdate(data: Record<string, unknown>, queryWhere?: Where): Promise<boolean> {
    if ('scope' in data || 'orgId' in data) return false
    return super.allowUpdate(data, queryWhere)
  }
}

// ── TicketStageRequest ─────────────────────────────────────────────────────────

const ticketByKey = parent({ model: 'ticket', fk: 'ticketId' })

/**
 * Stage requests: visible and editable through their ticket, and only an approver of the stage
 * (or a workspace admin) changes `status` or the reviewer fields.
 */
export class TicketStageRequestPolicyACL extends EntityACL {
  constructor(ctx: ACLContext, prisma: PrismaClient, opts: PolicyOptions = {}) {
    super(ctx, prisma, { parent: ticketByKey, ...opts })
  }

  protected async allowUpdate(data: Record<string, unknown>, queryWhere?: Where): Promise<boolean> {
    if (!touches(data, ['status', 'reviewedBy', 'reviewedAt', 'reviewerComment', 'reviewerCommentMessageId'])) return true
    if (this.isAdmin()) return true
    const rows = await targetRows<{ stageId: string }>(this.prisma, 'ticketStageRequest', queryWhere, { stageId: true })
    const stageIds = [...new Set(rows.map((r) => r.stageId))]
    if (stageIds.length === 0) return false
    const roleIds = (
      await this.prisma.userRoleMapping.findMany({ where: { userId: this.me, workspaceId: this.ws }, select: { roleId: true } })
    ).map((r) => r.roleId)
    const approved = await this.prisma.stageApprovers.findMany({
      where: {
        workspaceId: this.ws,
        stageId: { in: stageIds },
        OR: [{ userId: this.me }, ...(roleIds.length ? [{ roleId: { in: roleIds } }] : [])],
      },
      select: { stageId: true },
    })
    const ok = new Set(approved.map((a) => a.stageId))
    return stageIds.every((id) => ok.has(id))
  }
}
