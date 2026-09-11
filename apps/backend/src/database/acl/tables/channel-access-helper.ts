import { Prisma, PrismaClient } from '@prisma/client';import { GuestEntity, CanvasVisibility, ChannelVisibility } from '@xyne/shared';import type { ACLContext } from '../base-acl'

type GuestScope = {
  workspaceId: string
  userId: string
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values)].filter((v): v is string => v != null)
}

export function isGuestContext(
  ctx?: Pick<ACLContext, 'role' | 'workspaceId'>
): ctx is Pick<ACLContext, 'role' | 'workspaceId'> & { role: 'GUEST'; workspaceId: string } {
  return ctx?.role === 'GUEST' && Boolean(ctx.workspaceId)
}

export function denyGuestWhere(
  field: string,
  value = '__guest_blocked__'
): Record<string, string> {
  return { [field]: value }
}

async function getGuestScopeData(
  prisma: PrismaClient,
  scope: GuestScope
): Promise<{
  directChannelIds: string[]
  directCanvasIds: string[]
  participantChannelIds: string[]
}> {
  const [guestAccess, participantChannels] = await Promise.all([
    prisma.guestAccess.findMany({
      where: {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
      },
      select: {
        accessibleEntityId: true,
        accessibleEntityType: true,
      },
    }),
    prisma.channelParticipant.findMany({
      where: {
        userId: scope.userId,
        channel: {
          workspaceId: scope.workspaceId,
        },
      },
      select: {
        channelId: true,
      },
    }),
  ])

  const directChannelIds = guestAccess
    .filter((entry) => entry.accessibleEntityType === GuestEntity.CHANNEL)
    .map((entry) => entry.accessibleEntityId)

  const directCanvasIds = guestAccess
    .filter((entry) => entry.accessibleEntityType === GuestEntity.CANVAS)
    .map((entry) => entry.accessibleEntityId)

  return {
    directChannelIds: unique(directChannelIds),
    directCanvasIds: unique(directCanvasIds),
    participantChannelIds: unique(participantChannels.map((entry) => entry.channelId)),
  }
}

export async function getGuestAccessibleChannelIds(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const scope = await getGuestScopeData(prisma, { workspaceId, userId })

  return unique([
    ...scope.directChannelIds,
    ...scope.participantChannelIds,
  ])
}

/**
 * Whether a guest reaches `channelId` through any of their grants.
 *
 * Guest reach is not expressible as a participant lookup, so write clauses that
 * gate on participation need this as an additional arm to stay in step with the
 * sync layer. Returns false for non-guests, who are gated by their own rules.
 */
export async function hasGuestChannelAccess(
  prisma: PrismaClient,
  ctx: ACLContext,
  channelId: string
): Promise<boolean> {
  if (!isGuestContext(ctx)) {
    return false
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, workspaceId: ctx.workspaceId },
    select: { id: true },
  })
  if (!channel) {
    return false
  }

  const accessibleChannelIds = await getGuestAccessibleChannelIds(
    prisma,
    ctx.workspaceId,
    ctx.userId
  )

  return accessibleChannelIds.includes(channelId)
}

export async function getAccessibleChannelIds(
  prisma: PrismaClient,
  userId: string,
  ctx?: Pick<ACLContext, 'role' | 'workspaceId'>
): Promise<string[]> {
  if (isGuestContext(ctx)) {
    return getGuestAccessibleChannelIds(prisma, ctx.workspaceId, userId)
  }

  const participantChannels = await prisma.channelParticipant.findMany({
    where: { userId },
    select: { channelId: true },
  })

  const participantChannelIds = participantChannels.map((entry) => entry.channelId)

  const publicParticipantChannels = await prisma.channel.findMany({
    where: {
      id: { in: participantChannelIds },
      visibility: ChannelVisibility.PUBLIC,
    },
    select: { projectId: true },
  })

  const accessibleProjectIds = unique(publicParticipantChannels.map((entry) => entry.projectId))

  const publicChannelsInProjects = accessibleProjectIds.length
    ? await prisma.channel.findMany({
        where: {
          visibility: ChannelVisibility.PUBLIC,
          projectId: { in: accessibleProjectIds },
        },
        select: { id: true },
      })
    : []

  return unique([
    ...participantChannelIds,
    ...publicChannelsInProjects.map((entry) => entry.id),
  ])
}

export async function getAccessibleConversationIds(
  prisma: PrismaClient,
  userId: string,
  ctx?: Pick<ACLContext, 'role' | 'workspaceId'>
): Promise<string[]> {
  const accessibleChannelIds = await getAccessibleChannelIds(prisma, userId, ctx)
  if (!accessibleChannelIds.length) {
    return []
  }

  const conversations = await prisma.conversation.findMany({
    where: { channelId: { in: accessibleChannelIds } },
    select: { conversationId: true },
  })

  return conversations.map((entry) => entry.conversationId)
}

export async function getAccessibleTicketIds(
  prisma: PrismaClient,
  userId: string,
  ctx?: Pick<ACLContext, 'role' | 'workspaceId'>
): Promise<string[]> {
  const accessibleConversationIds = await getAccessibleConversationIds(prisma, userId, ctx)
  if (!accessibleConversationIds.length) {
    return []
  }

  const tickets = await prisma.ticket.findMany({
    where: { conversationId: { in: accessibleConversationIds } },
    select: { id: true },
  })

  return tickets.map((entry) => entry.id)
}

/**
 * Read predicate for every ticket-shaped table: same workspace, and the ticket's channel is
 * PUBLIC or the caller participates. Guests use `getAccessibleTicketIds` instead.
 *
 * Keep identical to TicketsACL.canSelect in packages/shared/src/zero/acl/tables/tickets-acl.ts,
 * which is what the UI reads through — the two share no code and nothing catches drift.
 * The PUBLIC arm is unconditional, matching ChannelsACL / MessagesACL / EmailsACL.
 */
export async function accessibleTicketWhere(
  _prisma: PrismaClient,
  ctx: Pick<ACLContext, 'userId' | 'workspaceId'>
): Promise<Prisma.TicketWhereInput> {
  return {
    workspaceId: ctx.workspaceId,
    channel: {
      OR: [
        { visibility: ChannelVisibility.PUBLIC },
        { participants: { some: { userId: ctx.userId } } },
      ],
    },
  }
}

export async function getAccessibleWorkflowIds(
  prisma: PrismaClient,
  userId: string,
  ctx?: Pick<ACLContext, 'role' | 'workspaceId'>
): Promise<string[]> {
  const accessibleTicketIds = await getAccessibleTicketIds(prisma, userId, ctx)
  if (!accessibleTicketIds.length) {
    return []
  }

  const workflows = await prisma.workflow.findMany({
    where: { ticketId: { in: accessibleTicketIds } },
    select: { id: true },
  })

  return workflows.map((entry) => entry.id)
}

export async function getAccessibleWorkflowExecutionIds(
  prisma: PrismaClient,
  userId: string,
  ctx?: Pick<ACLContext, 'role' | 'workspaceId'>
): Promise<string[]> {
  const accessibleWorkflowIds = await getAccessibleWorkflowIds(prisma, userId, ctx)
  if (!accessibleWorkflowIds.length) {
    return []
  }

  const executions = await prisma.workflowExecution.findMany({
    where: { workflowId: { in: accessibleWorkflowIds } },
    select: { id: true },
  })

  return executions.map((entry) => entry.id)
}

export async function getGuestVisibleUserIds(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const accessibleChannelIds = await getGuestAccessibleChannelIds(prisma, workspaceId, userId)
  if (!accessibleChannelIds.length) {
    return [userId]
  }

  const participants = await prisma.channelParticipant.findMany({
    where: {
      channelId: { in: accessibleChannelIds },
      channel: { workspaceId },
    },
    select: { userId: true },
  })

  return unique([userId, ...participants.map((entry) => entry.userId)])
}

export async function getGuestAccessibleCanvasIds(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const scope = await getGuestScopeData(prisma, { workspaceId, userId })
  const [accessibleChannelIds, userGroups] = await Promise.all([
    getGuestAccessibleChannelIds(prisma, workspaceId, userId),
    prisma.userGroupMapping.findMany({
      where: { userId },
      select: { userGroupId: true },
    }),
  ])

  const userGroupIds = userGroups.map((entry) => entry.userGroupId)

  const effectiveParticipantCanvases = await prisma.canvasParticipant.findMany({
    where: {
      OR: [
        { userId },
        ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
        ...(accessibleChannelIds.length ? [{ channelId: { in: accessibleChannelIds } }] : []),
      ],
    },
    select: { canvasId: true },
  })

  const effectivePublicCanvases = await prisma.canvas.findMany({
    where: {
      visibility: CanvasVisibility.PUBLIC,
      channelId: { in: accessibleChannelIds },
    },
    select: { id: true },
  })

  return unique([
    ...scope.directCanvasIds,
    ...effectiveParticipantCanvases.map((entry) => entry.canvasId),
    ...effectivePublicCanvases.map((entry) => entry.id),
  ])
}
