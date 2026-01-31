import { PrismaClient } from '@prisma/client'

export async function getAccessibleChannelIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  // Step 1: Get all channel IDs where user is a participant
  const participantChannels = await prisma.channelParticipant.findMany({
    where: { userId },
    select: { channelId: true },
  })

  const participantChannelIds = participantChannels.map((p) => p.channelId)

  // Step 2: Get project IDs from public channels where user participates
  const publicParticipantChannels = await prisma.channel.findMany({
    where: {
      id: { in: participantChannelIds },
      visibility: 'PUBLIC',
    },
    select: { projectId: true },
  })

  const accessibleProjectIds = [
    ...new Set(
      publicParticipantChannels
        .map((c) => c.projectId)
        .filter((id): id is string => id !== null)
    ),
  ]

  // Step 3: Get all public channels from accessible projects
  const publicChannelsInProjects = await prisma.channel.findMany({
    where: {
      visibility: 'PUBLIC',
      projectId: { in: accessibleProjectIds },
    },
    select: { id: true },
  })

  const publicChannelIds = publicChannelsInProjects.map((c) => c.id)

  // Combine: channels where user is participant + public channels in accessible projects
  const allAccessibleChannelIds = [...new Set([...participantChannelIds, ...publicChannelIds])]

  return allAccessibleChannelIds
}

export async function getAccessibleConversationIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const accessibleChannelIds = await getAccessibleChannelIds(prisma, userId)

  const conversations = await prisma.conversation.findMany({
    where: { channelId: { in: accessibleChannelIds } },
    select: { conversationId: true },
  })

  return conversations.map((c) => c.conversationId)
}

export async function getAccessibleTicketIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const accessibleConversationIds = await getAccessibleConversationIds(prisma, userId)

  const tickets = await prisma.ticket.findMany({
    where: { conversationId: { in: accessibleConversationIds } },
    select: { id: true },
  })

  return tickets.map((t) => t.id)
}

export async function getAccessibleWorkflowIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const accessibleTicketIds = await getAccessibleTicketIds(prisma, userId)

  const workflows = await prisma.workflow.findMany({
    where: { ticketId: { in: accessibleTicketIds } },
    select: { id: true },
  })

  return workflows.map((w) => w.id)
}

export async function getAccessibleWorkflowExecutionIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const accessibleWorkflowIds = await getAccessibleWorkflowIds(prisma, userId)

  const executions = await prisma.workflowExecution.findMany({
    where: { workflowId: { in: accessibleWorkflowIds } },
    select: { id: true },
  })

  return executions.map((e) => e.id)
}
