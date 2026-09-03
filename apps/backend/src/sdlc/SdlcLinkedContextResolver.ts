import type { PrismaClient } from '@prisma/client';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';

export interface SdlcContextLinkTarget {
  targetType: string;
  targetId: string;
}

export async function resolveAuthorizedSdlcLinkedContext(
  prisma: PrismaClient,
  links: SdlcContextLinkTarget[],
  userId: string,
  workspaceId: string
): Promise<string[]> {
  const values = await Promise.all(
    links.map(async (link) => {
      if (!(await canAccessLinkedEntity(prisma, link.targetType, link.targetId, userId, workspaceId))) {
        return null;
      }

      switch (link.targetType) {
        case 'MESSAGE': {
          const value = await prisma.message.findUnique({ where: { messageId: link.targetId } });
          return value ? `Message ${value.messageId}: ${value.content}` : null;
        }
        case 'CONVERSATION': {
          const value = await prisma.conversation.findUnique({
            where: { conversationId: link.targetId },
            include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
          });
          return value
            ? `Conversation ${value.conversationId}:\n${value.messages.map((item) => item.content).join('\n')}`
            : null;
        }
        case 'EMAIL': {
          const value = await prisma.email.findUnique({ where: { id: link.targetId } });
          return value ? `Email ${value.subject}:\n${value.body}` : null;
        }
        case 'TICKET': {
          const value = await prisma.ticket.findUnique({ where: { id: link.targetId } });
          return value ? `Ticket ${value.xyneId} ${value.title}:\n${value.description}` : null;
        }
        case 'CANVAS': {
          const value = await prisma.canvas.findUnique({ where: { id: link.targetId } });
          if (!value) return null;
          const markdown = await convertBlockNoteToMarkdown(value.content as unknown[]);
          return `Canvas ${value.title}:\n${markdown}`;
        }
        case 'CHANNEL': {
          const value = await prisma.channel.findUnique({ where: { id: link.targetId } });
          return value ? `Channel: ${value.name}` : null;
        }
        case 'CALL': {
          const value = await prisma.call.findUnique({ where: { id: link.targetId } });
          return value
            ? `Call ${value.title || value.externalId}:\n${value.aiSummary || value.transcript || value.description || ''}`
            : null;
        }
        case 'RECORDING': {
          const value = await prisma.callRecording.findUnique({
            where: { id: link.targetId },
            include: { call: { select: { title: true, transcript: true, aiSummary: true } } },
          });
          return value
            ? `Recording ${value.name || value.id} (${value.call.title || 'Call'}):\n${value.call.aiSummary || value.call.transcript || ''}`
            : null;
        }
        case 'ATTACHMENT': {
          const value = await prisma.messageAttachment.findUnique({ where: { id: link.targetId } });
          return value ? `Attachment ${value.originalFilename}: ${value.url}` : null;
        }
        case 'PULL_REQUEST': {
          const value = await prisma.pullRequests.findUnique({ where: { id: link.targetId } });
          return value ? `Pull request ${value.prUrl} (${value.status})` : null;
        }
        default:
          return null;
      }
    })
  );

  return values.filter((value): value is string => Boolean(value));
}

async function canAccessLinkedEntity(
  prisma: PrismaClient,
  type: string,
  id: string,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  let entityWorkspaceId: string | null | undefined;
  let channelId: string | null | undefined;

  switch (type) {
    case 'CANVAS': {
      const value = await prisma.canvas.findUnique({
        where: { id },
        select: { workspaceId: true, channelId: true, createdBy: true },
      });
      if (value?.workspaceId === workspaceId && value.createdBy === userId) return true;
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.channelId;
      break;
    }
    case 'TICKET': {
      const value = await prisma.ticket.findUnique({
        where: { id },
        select: { workspaceId: true, channelId: true },
      });
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.channelId;
      break;
    }
    case 'CHANNEL': {
      const value = await prisma.channel.findUnique({
        where: { id },
        select: { workspaceId: true, id: true },
      });
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.id;
      break;
    }
    case 'CONVERSATION': {
      const value = await prisma.conversation.findUnique({
        where: { conversationId: id },
        select: { workspaceId: true, channelId: true },
      });
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.channelId;
      break;
    }
    case 'MESSAGE': {
      const value = await prisma.message.findUnique({
        where: { messageId: id },
        include: { conversation: { select: { channelId: true } } },
      });
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.conversation.channelId;
      break;
    }
    case 'EMAIL': {
      const value = await prisma.email.findUnique({
        where: { id },
        select: { workspaceId: true, channelId: true },
      });
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.channelId;
      break;
    }
    case 'CALL': {
      const value = await prisma.call.findUnique({
        where: { id },
        select: { workspaceId: true, channelId: true, createdByUserId: true },
      });
      if (value?.workspaceId === workspaceId && value.createdByUserId === userId) return true;
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.channelId;
      break;
    }
    case 'RECORDING': {
      const value = await prisma.callRecording.findUnique({
        where: { id },
        include: { call: { select: { channelId: true } } },
      });
      if (value?.workspaceId === workspaceId && value.startedBy === userId) return true;
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.call.channelId;
      break;
    }
    case 'ATTACHMENT': {
      const value = await prisma.messageAttachment.findUnique({
        where: { id },
        include: { conversation: { select: { channelId: true } } },
      });
      if (value?.workspaceId === workspaceId && value.uploadedByUserId === userId) return true;
      entityWorkspaceId = value?.workspaceId;
      channelId = value?.conversation?.channelId;
      break;
    }
    case 'PULL_REQUEST': {
      const value = await prisma.pullRequests.findUnique({
        where: { id },
        select: { workspaceId: true },
      });
      return value?.workspaceId === workspaceId;
    }
    default:
      return false;
  }

  if (entityWorkspaceId !== workspaceId) return false;
  if (!channelId) return true;
  const membership = await prisma.channelParticipant.findFirst({
    where: { channelId, userId },
    select: { id: true },
  });
  return Boolean(membership);
}
