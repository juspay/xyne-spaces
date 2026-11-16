import { Prisma, PrismaClient } from '@prisma/client'
import type { ACLContext, MutateOp } from '../base-acl'
// Used only at call time, so the factory → policy map → classes → parents import cycle is safe.
import { ACLFactory } from '../acl-factory'

type Where = Record<string, unknown>

/**
 * How an Entity table reaches the row it belongs to (a message's channel, a comment's canvas).
 * The child's read and write rules are the PARENT's own policy, nested under the relation, so a
 * child can never be readable or writable more widely than its parent, and changing the parent's
 * policy changes every child with it.
 */
export interface ParentRule {
  /** Child rows whose parent the caller may read. */
  read(ctx: ACLContext, prisma: PrismaClient): Promise<Where>
  /** Child rows whose parent the caller may write. */
  write(ctx: ACLContext, prisma: PrismaClient, op: MutateOp): Promise<Where>
  /** The new child row points at a parent the caller may write (or, with `via: 'read'`, read). */
  canCreateUnder(
    ctx: ACLContext,
    prisma: PrismaClient,
    data: Record<string, unknown>,
    via?: 'write' | 'read',
  ): Promise<boolean>
}

export interface ParentSpec {
  /** Parent model, as the ACL factory names it ('channel', 'canvas', …). */
  model: Uncapitalize<Prisma.ModelName>
  /**
   * Relation path from the child to the parent, dot-separated, to-one hops only ('conversation.channel').
   * Omit when the child has only a key column and no Prisma relation: the rule then filters
   * `fk IN (ids of parents the caller may read/write)`.
   */
  path?: string
  /** Child column holding the parent's key ('channelId'). Used to authorize inserts. */
  fk: string
  /** Parent column that `fk` references. Default 'id'. */
  pk?: string
  /** Set false for a child table without a workspaceId column. Default true. */
  childHasWorkspace?: boolean
}

/** `{ a: { b: where } }` for path 'a.b'. */
function nest(path: string, where: Where): Where {
  return path
    .split('.')
    .reverse()
    .reduce<Where>((inner, key) => ({ [key]: inner }), where)
}

function withChildWorkspace(spec: ParentSpec, ctx: ACLContext, where: Where): Where {
  return spec.childHasWorkspace === false ? where : { AND: [{ workspaceId: ctx.workspaceId }, where] }
}

export function parent(spec: ParentSpec): ParentRule {
  const parentAcl = (ctx: ACLContext, prisma: PrismaClient) => ACLFactory.getACL(spec.model, ctx, prisma)
  const parentWrite = async (ctx: ACLContext, prisma: PrismaClient, op: MutateOp): Promise<Where> =>
    ((await parentAcl(ctx, prisma).getMutateWhere(undefined, op)) as Where | null) ?? { workspaceId: ctx.workspaceId }

  const pk = spec.pk ?? 'id'
  const delegateOf = (prisma: PrismaClient) =>
    (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Record<string, unknown>[]>; findFirst: (a: unknown) => Promise<unknown> }>)[spec.model]

  /** The child-side filter for a parent clause: nested under the relation, or by key list. */
  const onChild = async (ctx: ACLContext, prisma: PrismaClient, parentWhere: Where): Promise<Where> => {
    if (spec.path) return withChildWorkspace(spec, ctx, nest(spec.path, parentWhere))
    const rows = await delegateOf(prisma).findMany({ where: parentWhere, select: { [pk]: true } })
    return withChildWorkspace(spec, ctx, { [spec.fk]: { in: rows.map((r) => r[pk]) } })
  }

  return {
    async read(ctx, prisma) {
      const w = ((await parentAcl(ctx, prisma).getWhereClause()) as Where | null) ?? { workspaceId: ctx.workspaceId }
      return onChild(ctx, prisma, w)
    },

    async write(ctx, prisma, op) {
      return onChild(ctx, prisma, await parentWrite(ctx, prisma, op))
    },

    async canCreateUnder(ctx, prisma, data, via = 'write') {
      const key = data[spec.fk]
      if (typeof key !== 'string' || key === '') return false
      const parentWhere =
        via === 'read'
          ? (((await parentAcl(ctx, prisma).getWhereClause()) as Where | null) ?? { workspaceId: ctx.workspaceId })
          : await parentWrite(ctx, prisma, 'update')
      const row = await delegateOf(prisma).findFirst({
        where: { AND: [{ [pk]: key }, parentWhere] },
        select: { [pk]: true },
      })
      return row !== null
    },
  }
}

// Common parents. A child whose relation or column is named differently builds its own with parent().
export const channelParent = parent({ model: 'channel', path: 'channel', fk: 'channelId' })
export const conversationParent = parent({
  model: 'conversation',
  path: 'conversation',
  fk: 'conversationId',
  pk: 'conversationId',
})
export const ticketParent = parent({ model: 'ticket', path: 'ticket', fk: 'ticketId' })
export const canvasParent = parent({ model: 'canvas', path: 'canvas', fk: 'canvasId' })
export const callParent = parent({ model: 'call', path: 'call', fk: 'callId' })
