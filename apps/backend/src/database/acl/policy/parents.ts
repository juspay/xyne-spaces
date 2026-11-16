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
  /** The new child row points at a parent the caller may write. */
  canCreateUnder(ctx: ACLContext, prisma: PrismaClient, data: Record<string, unknown>): Promise<boolean>
}

export interface ParentSpec {
  /** Parent model, as the ACL factory names it ('channel', 'canvas', …). */
  model: Uncapitalize<Prisma.ModelName>
  /** Relation path from the child to the parent, dot-separated, to-one hops only ('conversation.channel'). */
  path: string
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

  return {
    async read(ctx, prisma) {
      const w = ((await parentAcl(ctx, prisma).getWhereClause()) as Where | null) ?? { workspaceId: ctx.workspaceId }
      return withChildWorkspace(spec, ctx, nest(spec.path, w))
    },

    async write(ctx, prisma, op) {
      return withChildWorkspace(spec, ctx, nest(spec.path, await parentWrite(ctx, prisma, op)))
    },

    async canCreateUnder(ctx, prisma, data) {
      const key = data[spec.fk]
      if (typeof key !== 'string' || key === '') return false
      const delegate = (prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>)[spec.model]
      const row = await delegate.findFirst({
        where: { AND: [{ [spec.pk ?? 'id']: key }, await parentWrite(ctx, prisma, 'update')] },
        select: { [spec.pk ?? 'id']: true },
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
