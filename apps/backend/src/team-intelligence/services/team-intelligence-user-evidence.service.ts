import { config as appConfig } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export interface TeamIntelligenceUserEvidence {
  user: {
    id: string;
    email: string;
    name: string;
    role: string | null;
    workspaceId: string | null;
    organizationId: string | null;
    resolvedInWorkspace: boolean;
  };
  tickets: unknown[];
  conversations: unknown[];
  calls: unknown[];
  canvases: unknown[];
}

function getUtcDayBounds(reportDate: Date): { start: Date; end: Date; nextWeek: Date } {
  const start = new Date(reportDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const nextWeek = new Date(end);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  return { start, end, nextWeek };
}

class TeamIntelligenceUserEvidenceService {
  async collect(
    userEmail: string,
    userName: string,
    reportDate: Date,
    ingestionWorkspaceId?: string | null
  ): Promise<TeamIntelligenceUserEvidence> {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const preferredWorkspaceIds = [
      ingestionWorkspaceId?.trim(),
      appConfig.defaultWorkspaceId?.trim(),
    ].filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index
    );
    const userSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      workspaceId: true,
      workspace: { select: { orgId: true } },
    } as const;

    let user = preferredWorkspaceIds.length > 0
      ? await db.user.findFirst({
          where: {
            workspaceId: { in: preferredWorkspaceIds },
            email: { equals: normalizedEmail, mode: 'insensitive' },
            leftAt: null,
          },
          select: userSelect,
        })
      : null;

    if (!user) {
      const matchingUsers = await db.user.findMany({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          leftAt: null,
        },
        take: 2,
        select: userSelect,
      });
      if (matchingUsers.length > 1) {
        throw new Error(
          `Multiple active Spaces users found for ${userEmail}; Team Intelligence requires a workspaceId to avoid cross-workspace evidence`
        );
      }
      user = matchingUsers[0] ?? null;
    }

    if (!user) {
      logger.warn('[TEAM-INTEL-EVIDENCE] No Spaces user found; continuing with incoming activity only', {
        userEmail: normalizedEmail,
        ingestionWorkspaceId: ingestionWorkspaceId ?? null,
      });
      return {
        user: {
          id: `external:${normalizedEmail}`,
          email: normalizedEmail,
          name: userName,
          role: null,
          workspaceId: ingestionWorkspaceId?.trim() || null,
          organizationId: null,
          resolvedInWorkspace: false,
        },
        tickets: [],
        conversations: [],
        calls: [],
        canvases: [],
      };
    }

    const workspaceId = user.workspaceId;

    const { start, end, nextWeek } = getUtcDayBounds(reportDate);
    const userId = user.id;

    const [tickets, conversations, calls] = await Promise.all([
      db.ticket.findMany({
        where: {
          workspaceId,
          isArchived: false,
          AND: [
            {
              OR: [
                { assignedTo: userId },
                { createdBy: userId },
                { updatedBy: userId },
                { closedBy: userId },
                { assignments: { some: { userId } } },
                { activities: { some: { updatedBy: userId } } },
              ],
            },
            {
              OR: [
                { statusV2: { in: ['TODO', 'STARTED', 'PAUSED'] } },
                { createdAt: { gte: start, lt: end } },
                { updatedAt: { gte: start, lt: end } },
                { statusUpdatedAt: { gte: start, lt: end } },
                { closedAt: { gte: start, lt: end } },
                { eta: { gte: start, lt: nextWeek } },
                { activities: { some: { timestamp: { gte: start, lt: end } } } },
              ],
            },
          ],
        },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          xyneId: true,
          title: true,
          description: true,
          statusV2: true,
          priority: true,
          stageName: true,
          ticketType: true,
          createdBy: true,
          updatedBy: true,
          assignedTo: true,
          closedBy: true,
          createdAt: true,
          updatedAt: true,
          statusUpdatedAt: true,
          eta: true,
          closedAt: true,
          conversationId: true,
          channelId: true,
          projectId: true,
          boardId: true,
          metadata: true,
          referenceTicket: true,
          tags: { select: { id: true, name: true } },
          assignments: {
            select: {
              id: true,
              userId: true,
              userResponsibility: true,
              roleId: true,
              createdAt: true,
              createdBy: true,
            },
          },
          activities: {
            where: { timestamp: { gte: start, lt: end } },
            orderBy: { timestamp: 'asc' },
            select: {
              id: true,
              updatedBy: true,
              timestamp: true,
              activityType: true,
              value: true,
            },
          },
        },
      }),
      db.conversation.findMany({
        where: {
          workspaceId,
          lastActivityAt: { gte: start, lt: end },
          OR: [
            { createdBy: userId },
            { participants: { some: { userId } } },
            { messages: { some: { senderId: userId, createdAt: { gte: start, lt: end } } } },
          ],
        },
        orderBy: { lastActivityAt: 'desc' },
        select: {
          conversationId: true,
          channelId: true,
          createdBy: true,
          initialMessageId: true,
          parentMessageId: true,
          ticketId: true,
          callId: true,
          lastActivityAt: true,
          replyCount: true,
          pinned: true,
          metadata: true,
          createdAt: true,
          participants: {
            select: {
              userId: true,
              participationType: true,
              joinedAt: true,
              lastReplyAt: true,
            },
          },
          messages: {
            where: {
              isDeleted: false,
              isSent: true,
              OR: [{ visibleTo: null }, { visibleTo: userId }],
            },
            orderBy: { createdAt: 'asc' },
            select: {
              messageId: true,
              senderId: true,
              content: true,
              msgType: true,
              hasAttachment: true,
              edited: true,
              showInChannel: true,
              createdAt: true,
              metadata: true,
              reactions_md: true,
              link_preview_md: true,
              sender: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      db.call.findMany({
        where: {
          workspaceId,
          OR: [
            { createdByUserId: userId },
            { organizerId: userId },
            { participants: { some: { userId } } },
          ],
          AND: [{
            OR: [
              { startedAt: { gte: start, lt: end } },
              { startsAt: { gte: start, lt: nextWeek } },
              {
                AND: [
                  { startedAt: { lt: end } },
                  { OR: [{ endedAt: null }, { endedAt: { gte: start } }] },
                ],
              },
            ],
          }],
        },
        orderBy: { startedAt: 'asc' },
        select: {
          id: true,
          externalId: true,
          title: true,
          description: true,
          createdByUserId: true,
          organizerId: true,
          channelId: true,
          orgName: true,
          callType: true,
          callOrigin: true,
          status: true,
          startsAt: true,
          endsAt: true,
          timezone: true,
          isRecurring: true,
          transcript: true,
          aiSummary: true,
          startedAt: true,
          endedAt: true,
          lastActivityAt: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          participants: {
            select: {
              userId: true,
              displayName: true,
              email: true,
              isExternal: true,
              response: true,
              meetingStatus: true,
              joinedAt: true,
              leftAt: true,
            },
          },
        },
      }),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: user.workspaceId,
        organizationId: user.workspace.orgId,
        resolvedInWorkspace: true,
      },
      tickets: tickets.map((ticket) => ({
        evidenceId: `ticket:${ticket.id}`,
        ...ticket,
        activities: ticket.activities.map((activity) => ({
          evidenceId: `ticket-activity:${activity.id}`,
          ...activity,
        })),
      })),
      conversations: conversations.map((conversation) => ({
        evidenceId: `conversation:${conversation.conversationId}`,
        conversationType: conversation.ticketId
          ? 'TICKET'
          : conversation.callId
            ? 'CALL'
            : 'CHANNEL_THREAD',
        ...conversation,
        messages: conversation.messages.map((message) => ({
          evidenceId: `message:${message.messageId}`,
          ...message,
        })),
      })),
      calls: calls.map((call) => ({
        evidenceId: `call:${call.id}`,
        ...call,
      })),
      canvases: [],
    };
  }
}

export const teamIntelligenceUserEvidenceService = new TeamIntelligenceUserEvidenceService();
