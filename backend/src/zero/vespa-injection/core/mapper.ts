import { extractMentionsFromContent } from '@/utils/mentionUtils';
import { channelSchema, InsertDocument, messageSchema, projectSchema, schemaToDocType, SubApp, ticketSchema, VespaChatContainerDocument, VespaChatMessageDocument, VespaDocType, VespaFileDocument, VespaProjectDocument, VespaSchema, VespaTicketDocument } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';
import type { InsertValue } from '@rocicorp/zero';
import { ChannelScopeType, ChannelVisibility, TicketStatus, TicketStatusV2, type Schema } from '@xyne/shared';
import { VespaJob, VespaJobType, VespaPayload } from './types';
import { db } from '@/database/client';
import { Conversation, Channel, Message, Project, Ticket, VespaOperationType as VespaOpType, Canvas, Call } from '@prisma/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import vespaClient from '@/vespa/client';
import { messageSignalService } from '@/services/personalization';
import { logger } from '@/utils/logger';
import { RCAWithRelations, ReleaseRepository } from '@/database/repositories/releaseRepository';
import { fileSchema } from '@xyne/vespa-ts';
import { config } from '@/config/env';
import { TextStrategy } from '../strategies/TextStrategy';
import { GCSService } from '@/services/gcsService';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';

type ChannelsSchema = Schema['tables']['channels'];
type MessagesSchema = Schema['tables']['messages'];
type ProjectsSchema = Schema['tables']['projects'];
type TicketsSchema = Schema['tables']['tickets'];
type CanvasesSchema = Schema['tables']['canvases'];
type TranscriptsSchema = Schema['tables']['calls'];

const getRef = (schema: VespaSchema, docId: string) => `id:${NAMESPACE}:${schema}::${docId}`

/**
 * Convert timestamp to number (Unix timestamp in milliseconds)
 * Handles both string dates and number timestamps
 */
const toTimestamp = (timestamp: Date | string | number | null | undefined): number => {
  if (!timestamp) return 0;
  return typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
}
const toDateString = (date: Date | string | number | null | undefined): string => {
  if (!date) return '';

  const d = typeof date === 'object' && date instanceof Date
    ? date
    : new Date(date);

  if (isNaN(d.getTime())) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
};

/**
 * Map old TicketStatus to new TicketStatusV2
 * Used for backward compatibility during migration
 */
const mapStatusToStatusV2 = (status: TicketStatus): TicketStatusV2 => {
  const mapping: Record<TicketStatus, TicketStatusV2> = {
    [TicketStatus.NEW]: TicketStatusV2.TODO,
    [TicketStatus.IN_PROGRESS]: TicketStatusV2.STARTED,
    [TicketStatus.WAIT_FOR_APPROVAL]: TicketStatusV2.PAUSED,
    [TicketStatus.REJECTED]: TicketStatusV2.CANCELLED,
    [TicketStatus.RESOLVED]: TicketStatusV2.COMPLETED,
  };
  return mapping[status] || TicketStatusV2.TODO;
}

/**
 * Resolve channel name by converting DM/GROUP_DM user IDs to user names
 */
const resolveChannelName = async (channelName: string, scopeType: string | null | undefined): Promise<string> => {
  if (!scopeType || !channelName) {
    return channelName;
  }

  if (scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM) {
    const userIds = channelName.split(",");
    const usernames = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { name: true }
    });
    return usernames.map(u => u.name).join(",");
  }

  return channelName;
}

/**
 * Resolve parent and child ticket xyneIds for a given ticket
 */
const resolveTicketRelationships = async (ticketId: string): Promise<{
  parentTicketXyneId: string;
  childTicketXyneIds: string[];
}> => {
  // find parent ticket xyneId
  let parentTicketXyneId = '';
  const subTicket = await db.subTicket.findFirst({
    where: { mappedTicketId: ticketId }
  });

  if (subTicket) {
    const parentMapping = await db.ticketSubTicketMapping.findFirst({
      where: { subTicketId: subTicket.id }
    });

    if (parentMapping) {
      const parentTicket = await db.ticket.findUnique({
        where: { id: parentMapping.ticketId },
        select: { xyneId: true }
      });
      parentTicketXyneId = parentTicket?.xyneId || '';
    }
  }
  // find child ticket xyneIds
  let childTicketXyneIds: string[] = [];
  const childMappings = await db.ticketSubTicketMapping.findMany({
    where: { ticketId: ticketId }
  });

  if (childMappings.length > 0) {
    const subTicketIds = childMappings.map(m => m.subTicketId);

    const subTickets = await db.subTicket.findMany({
      where: { id: { in: subTicketIds } },
      select: { mappedTicketId: true }
    });

    const mappedTicketIds = subTickets
      .map(st => st.mappedTicketId)
      .filter((id): id is string => id !== null);

    if (mappedTicketIds.length > 0) {
      const childTickets = await db.ticket.findMany({
        where: { id: { in: mappedTicketIds } },
        select: { xyneId: true }
      });
      childTicketXyneIds = childTickets.map(t => t.xyneId);
    }
  }
  return { parentTicketXyneId, childTicketXyneIds };
};

export const getThreadInfo = async (
  conversationId: string
): Promise<{
  messages: Message[],
  threadMentions: string[],
  threadSenders: string[]
}> => {
  const messages = await db.message.findMany({
    where: { conversationId }
  }) || [];

  if (messages.length === 0) {
    return { messages: [], threadMentions: [], threadSenders: [] };
  }

  // Extract mentions from all messages
  const mentionsPerMessage = await Promise.all(
    messages.map(m => extractMentionsFromContent(m.content))
  ) || [];
  const threadMentions = mentionsPerMessage.flatMap(mentions => mentions?.map(v => v.username) || []);

  // Get sender names
  const senderIds = [...new Set(messages.map(msg => msg.senderId))];
  const senders = await db.user.findMany({
    where: { id: { in: senderIds } },
  }) || [];
  const threadSenders = senders.map(s => s.name).filter(Boolean) as string[];

  return { messages, threadMentions, threadSenders };
};
/**
 * Update ticket thread fields in Vespa when messages change
 * Called by message mutations to keep ticket search synchronized with conversation state
 */
export const updateTicketThreadFields = async (conversationId: string): Promise<void> => {
  // Find ticket for this conversation
  const ticket = await db.ticket.findFirst({
    where: { conversationId }
  });

  if (!ticket) return; // Not a ticket conversation

  const { messages, threadMentions, threadSenders } = await getThreadInfo(conversationId);

  if (messages.length === 0) {
    // All messages deleted - clear thread fields
    await vespaClient.crudService.update(
      ticket.id,
      {
        docType: VespaDocType.TICKET,
        docId: ticket.id,
        threadMentions: [],
        threadSenders: [],
        initialMessage: '',
        initialMessageSender: ''
      },
      ticketSchema
    );
    return;
  }

  // Get initial message
  const initialMsg = messages.reduce((earliest, msg) =>
    msg.createdAt < earliest.createdAt ? msg : earliest
  );
  const initialMessage = extractPlainTextFromHtml(initialMsg.content || '');
  const initialSender = await db.user.findUnique({
    where: { id: initialMsg.senderId },
    select: { name: true }
  });

  logger.info(`[TICKET THREAD FIELDS UPDATE] Updating thread fields for ticket ${ticket.id}, conversationId: ${conversationId}`);

  // Update ticket in Vespa
  await vespaClient.crudService.update(
    ticket.id,
    {
      docType: VespaDocType.TICKET,
      docId: ticket.id,
      threadMentions,
      threadSenders,
      initialMessage,
      initialMessageSender: initialSender?.name || ''
    },
    ticketSchema
  );
};

export const mapChannel = async (
  args: InsertValue<ChannelsSchema> | Channel,
  participants?: string[]
): Promise<VespaChatContainerDocument> => {
  let channelParticipants = participants
  if (!channelParticipants) {
    channelParticipants = (await db.channelParticipant.findMany({
      where: { channelId: args.id }
    })).map(v => v.userId)
  }

  const channelName = await resolveChannelName(args.name, args.scopeType);
  return {
    docType: VespaDocType.CHANNEL,
    docId: args.id,
    channelName: channelName,
    description: args.description || '',
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
    permissions: channelParticipants,
    isPrivate: args.visibility === ChannelVisibility.PRIVATE,
    createdBy: args.createdBy,
    ownerId: args.createdBy,
    projectId: args.projectId,
    visibility: args.visibility,
    isIm: args.scopeType === ChannelScopeType.DM,
    isMpim: args.scopeType === ChannelScopeType.GROUP_DM,
    scopeType: args.scopeType,
    metadata: JSON.stringify(args.metadata) || '',
    lastActivityAt: toTimestamp(args.lastActivityAt),
    lastSyncedAt: toTimestamp(args.lastActivityAt),
    topic: "",// TODO: handle topic,
    memberCount: channelParticipants.length,
    isArchived: false, // TODO: handle archived state
  };
}

export const updateChannelNameInPreviousMessages = async (
  id: string,
  channelName?: string,
): Promise<void> => {
  const conversationBatchSize = 50;

  let lastConversationId: string | undefined;

  while (true) {
    const conversationQuery: Parameters<
      typeof db.conversation.findMany
    >[0] = {
      where: { channelId: id },
      take: conversationBatchSize,
      orderBy: { conversationId: 'asc' },
    };

    if (lastConversationId) {
      conversationQuery.cursor = { conversationId: lastConversationId };
      conversationQuery.skip = 1;
    }

    const conversations: Conversation[] =
      await db.conversation.findMany(conversationQuery);

    if (conversations.length === 0) break;

    for (const conversation of conversations) {
      const messageBatchSize = 50;
      let lastMessageId: string | undefined;

      while (true) {
        const messageQuery: Parameters<
          typeof db.message.findMany
        >[0] = {
          where: { conversationId: conversation.conversationId },
          take: messageBatchSize,
          orderBy: { messageId: 'asc' },
        };

        if (lastMessageId) {
          messageQuery.cursor = { messageId: lastMessageId };
          messageQuery.skip = 1;
        }

        const messages: Message[] =
          await db.message.findMany(messageQuery);

        if (messages.length === 0) break;

        await Promise.all(
          messages.map((message) =>
            vespaClient.crudService.update(
              message.messageId,
              {
                docType: VespaDocType.MESSAGE,
                docId: message.messageId,
                messageChannelName: channelName || '',
              },
              messageSchema,
            )
          )
        );

        lastMessageId = messages[messages.length - 1].messageId;
      }
    }

    lastConversationId =
      conversations[conversations.length - 1].conversationId;
  }
};

export const mapAndUpdatePreviousMessagesMentions = async (
  messageId: string,
  conversationId: string,
): Promise<{ threadMentions: string[], threadSenders: string[] }> => {
  const { messages, threadMentions, threadSenders } = await getThreadInfo(conversationId);

  const filteredMessages = messages.filter(m => m.messageId !== messageId);
  logger.info(`[MESSAGE THREAD MENTIONS UPDATE] Updating messages for conversationId: ${conversationId}`);

  await Promise.all(
    filteredMessages.map(message =>
      vespaClient.crudService.update(
        message.messageId,
        {
          docType: VespaDocType.MESSAGE,
          docId: message.messageId,
          threadMentions,
          threadSenders,
        },
        messageSchema,
      )
    )
  );
  return { threadMentions, threadSenders };
};

export const mapMessage = async (
  args: InsertValue<MessagesSchema>
): Promise<VespaChatMessageDocument> => {
  const conversation = await db.conversation.findUnique({
    where: { conversationId: args.conversationId }
  });

  if (!conversation?.channelId) {
    throw new Error("Didn't find channel for this message")
  }

  const msgChannel = await db.channel.findUnique({
    where: { id: conversation.channelId }
  });

  let channelScopeType = msgChannel?.scopeType;
  let msgChannelName = await resolveChannelName(msgChannel?.name || '', msgChannel?.scopeType);


  const [
    mentions,
    sender,
    attachments
  ] = await Promise.all([
    extractMentionsFromContent(args.content),
    db.user.findUnique({
      where: { id: args.senderId }
    }),
    db.messageAttachment.findMany({
      where: { conversationId: args.conversationId }
    }),
  ])

  const messageContent =
    extractPlainTextFromHtml(args.content || '') || ''

  const threadInfo = await mapAndUpdatePreviousMessagesMentions(args.messageId, args.conversationId);

  // Update parent ticket thread fields if this is a ticket conversation
  await updateTicketThreadFields(args.conversationId);

  // Capturing signal for a new message  
  messageSignalService.captureCreateMessage({
    messageId: args.messageId,
    senderId: args.senderId,
    conversationId: args.conversationId,
    channelId: conversation.channelId,
    mentionUserIds: mentions?.map(v => v.userId) || [],
    channelScopeType: (channelScopeType as ChannelScopeType) || undefined,
    replyCount: conversation.replyCount || 0,
    isReply: (conversation.replyCount || 0) > 0,
  }).catch(err => {
    logger.error('Failed to capture message signals', err);
  });

  return {
    docId: args.messageId,
    docType: VespaDocType.MESSAGE,
    text: messageContent,
    username: sender?.name || '',
    userEmail: sender?.email || '',
    image: "",
    userId: args.senderId,
    createdAtTimestamp: toTimestamp(args.createdAt),
    createdAt: toDateString(args.createdAt),
    updatedAt: toDateString(args.createdAt),
    deletedAt: 0,
    channelRef: getRef(channelSchema, conversation.channelId),
    threadId: args.conversationId,
    channelWeightedSet: {
      [`channel:${conversation.channelId}`]: 1
    },
    userWeightedSet: {
      [`user:${args.senderId}`]: 1
    },
    attachmentIds: attachments.map(a => a.entityId),
    reactions: 0, // TODO
    replyCount: conversation.replyCount || 0,
    replyUsersCount: 0, // TODO
    mentions: mentions?.map(v => v.username) || [],
    metadata: JSON.stringify(args.metadata || {}),
    threadMentions: threadInfo.threadMentions,
    threadSenders: threadInfo.threadSenders,
    messageChannelName: msgChannelName || '',
    messageType: args.msgType || 'USER',
  }
}


export const mapProject = (args: InsertValue<ProjectsSchema>): VespaProjectDocument => ({
  docId: args.id,
  docType: VespaDocType.PROJECT,
  name: args.name,
  description: args.description || "",
  createdBy: args.createdBy,
  createdAt: toTimestamp(args.createdAt),
  updatedAt: toTimestamp(args.updatedAt),
  updatedBy: args.updatedBy || ""
})


export const mapTicket = async (args: InsertValue<TicketsSchema>): Promise<VespaTicketDocument> => {
  const [
    conversation,
    attachments,
    parentTicket,
    tags,
    board,
    channel,
    project,
    createdByUser,
    assignedToUser,
    closedByUser,
    descriptionMentions
  ] = await Promise.all([
    db.conversation.findUnique({
      where: { conversationId: args.conversationId }
    }),
    db.messageAttachment.findMany({
      where: { conversationId: args.conversationId }
    }),
    db.subTicket.findFirst({
      where: { mappedTicketId: args.id }
    }),
    db.ticketTag.findMany({
      where: { ticketId: args.id },
      select: { name: true }
    }),
    db.board.findUnique({
      where: { id: args.boardId },
      select: { name: true }
    }),
    db.channel.findUnique({
      where: { id: args.channelId },
      select: { name: true, scopeType: true }
    }),
    db.project.findUnique({
      where: { id: args.projectId },
      select: { name: true }
    }),
    db.user.findUnique({
      where: { id: args.createdBy },
      select: { name: true }
    }),
    args.assignedTo ? db.user.findUnique({
      where: { id: args.assignedTo },
      select: { name: true }
    }) : Promise.resolve(null),
    args.closedBy ? db.user.findUnique({
      where: { id: args.closedBy },
      select: { name: true }
    }) : Promise.resolve(null),
    extractMentionsFromContent(args.description)
  ])

  // Resolve parent/child ticket relationships
  const { parentTicketXyneId, childTicketXyneIds } = await resolveTicketRelationships(args.id);
  const { messages, threadMentions, threadSenders } = await getThreadInfo(args.conversationId);

  // Get initial message (first message in conversation)
  let initialMessage = '';
  let initialMessageSender = '';

  if (messages.length > 0) {
    const initialMsg = messages.reduce((earliest, msg) =>
      msg.createdAt < earliest.createdAt ? msg : earliest
    );
    initialMessage = extractPlainTextFromHtml(initialMsg.content || '');
    const sender = await db.user.findUnique({
      where: { id: initialMsg.senderId },
      select: { name: true }
    });
    initialMessageSender = sender?.name || '';
  }

  const resolvedChannelName = await resolveChannelName(channel?.name || '', channel?.scopeType);
  return {
    docId: args.id,
    docType: VespaDocType.TICKET,
    convId: args.conversationId,
    userGroupId: args.userGroupId,
    channelRef: getRef(channelSchema, conversation?.channelId || ""),// if there is no channelId we can refer it with projectRef
    projectRef: getRef(projectSchema, args.projectId),
    threadId: args.conversationId,
    status: (args.statusV2 || mapStatusToStatusV2(args.status as TicketStatus)) as TicketStatusV2,
    ownerEmail: args.createdBy, // TODO get user email
    assignedTo: args.assignedTo || "",
    createdBy: args.createdBy,
    closedBy: args.closedBy || "",
    title: args.title,
    workflowType: "",// later we should populate workflow type
    description: args.description,
    ticketType: "", // later we should populate ticket type
    priority: args.priority,
    stage: args.stageName,
    createdAtTimestamp: toTimestamp(args.createdAt),
    createdAt: toDateString(args.createdAt),
    updatedAt: toDateString(args.updatedAt),
    closedAt: toDateString(args.closedAt),
    deletedAt: toDateString(args.closedAt), // TODO get the deletedAT
    parentTicketId: parentTicket?.mappedTicketId || "",
    boardId: args.boardId,
    attachmentIds: attachments.map(a => a.id),
    metadata: JSON.stringify(args.metadata),
    eta: toDateString(args.eta),
    channelName: resolvedChannelName,
    boardName: board?.name || '',
    xyneId: args.xyneId,
    tags: tags.map(t => t.name),
    createdByName: createdByUser?.name || '',
    assignedToName: assignedToUser?.name || '',
    closedByName: closedByUser?.name || '',
    projectName: project?.name || '',
    ticketMentions: descriptionMentions?.map(v => v.username) || [],
    threadMentions: threadMentions,
    threadSenders: threadSenders,
    initialMessage: initialMessage,
    initialMessageSender: initialMessageSender,
    parentTicketXyneId: parentTicketXyneId,
    childTicketXyneIds: childTicketXyneIds
  }
}

export const mapCanvas = async (args: InsertValue<CanvasesSchema>): Promise<VespaFileDocument> => {
  // Get channel info if channelId exists
  let channelRef: string | undefined;
  if (args.channelId) {
    channelRef = getRef(channelSchema, args.channelId);
  }

  let chunks: string[] = [];

  // Focus only on manually created canvases (stored in DB as BlockNote JSON)
  try {
    const content = (args as any).content;

    if (content) {
      const markdown = await convertBlockNoteToMarkdown(content);
      const textStrategy = new TextStrategy();
      const result = await textStrategy.parse(Buffer.from(markdown), args.id);
      chunks = result.chunks;

      logger.info(`[Mapper] Extracted ${chunks.length} chunks from canvas ${args.id} using TextStrategy`);
    } else {
      logger.warn(`[Mapper] Canvas ${args.id} has no content to index`);
    }
  } catch (error) {
    logger.error(`[Mapper] Failed to extract text from canvas ${args.id}:`, error);
  }

  // Get canvas participants for permissions
  const canvasParticipants = await db.canvasParticipant.findMany({
    where: { canvasId: args.id }
  });
  const permissions = canvasParticipants.map(p => p.userId);

  const channel = args.channelId ? (await db.channel.findUnique({
    where: { id: args.channelId }
  })) : undefined;

  return {
    docId: args.id,
    docType: VespaDocType.FILE,
    fileName: args.title || 'Untitled Canvas',
    description: `Canvas document${channel?.name ? ' in channel : ' + channel.name : ''}`,
    chunks: chunks,
    chunks_pos: chunks.map((_, index) => String(index)),
    image_chunks: [],
    image_chunks_pos: [],
    metadata: JSON.stringify({
      channelId: args.channelId,
      viewAccessId: args.viewAccessId,
      editAccessId: args.editAccessId,
      lastEditedBy: args.lastEditedBy,
      lastEditedAt: args.lastEditedAt,
      docType: args.docType,
      contentIndexed: chunks.length > 0
    }),
    createdBy: args.createdBy,
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
    ownerId: args.createdBy,
    permissions: permissions,
    urlInternal: '',
    urlOriginal: '',
    fileSize: 0,
    isPrivate: true,
    mimeType: 'application/json',
    subApp: 'canvas',
    channelRef,
    conversationId: undefined
  };
};

export const mapTranscript = async (args: InsertValue<TranscriptsSchema>): Promise<VespaFileDocument> => {
  // Get conversation and channel info from call data
  let channelRef: string | undefined;
  let conversationId: string | undefined;

  // Get channel info directly from call's channelId
  if (args.channelId) {
    channelRef = getRef(channelSchema, args.channelId);
  }

  // Find conversation by callId (using externalId)
  const conversation = await db.conversation.findFirst({
    where: { callId: args.externalId }
  });
  if (conversation) {
    conversationId = conversation.conversationId;
  }
  else { 
    const callMetadata = args.metadata as { conversationId?: string } | null;
    conversationId = callMetadata?.conversationId;
  }

  // Fetch transcript content from GCS using the transcript URL
  let chunks: string[] = [];
  let fileSize = 0;
  try {
    if (args.transcript) {
      // Extract GCS path from URL (gs://bucket/path or just path)
      let gcsPath = args.transcript;
      if (gcsPath.startsWith('gs://')) {
        const match = gcsPath.match(/^gs:\/\/[^\/]+\/(.+)$/);
        if (match) {
          gcsPath = match[1];
        }
      }

      // Use transcript bucket for fetching
      const gcsService = new GCSService(config.gcs.transcriptionBucketName);
      const buffer = await gcsService.getFileBuffer(gcsPath);
      fileSize = buffer.length;

      const textStrategy = new TextStrategy();
      const result = await textStrategy.parse(buffer, args.id);
      chunks = result.chunks;

      logger.info(`[Mapper] Extracted ${chunks.length} chunks from transcript ${args.id} using TextStrategy`);
    }
  } catch (error) {
    logger.error(`[Mapper] Failed to fetch transcript content for ${args.id}:`, error);
    // Continue with empty chunks - don't fail the entire operation
  }

  // Get call participants for permissions using call ID
  let permissions: string[] = [];
  const callParticipants = await db.callParticipant.findMany({
    where: { callId: args.id }
  });
  permissions = callParticipants.map(p => p.userId);

  return {
    docId: args.id,
    docType: VespaDocType.FILE,
    fileName: args.title || 'Transcript',
    description: args.aiSummary || '',
    chunks: chunks,
    chunks_pos: chunks.map((_, index) => String(index)),
    image_chunks: [],
    image_chunks_pos: [],
    metadata: JSON.stringify({
      conversationId: conversationId,
      callId: args.id,
      externalId: args.externalId,
      callType: args.callType,
      status: args.status,
      metadata: args.metadata
    }),
    createdBy: args.createdByUserId,
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
    ownerId: args.createdByUserId,
    permissions: permissions,
    urlInternal: args.transcript || '',
    urlOriginal: args.transcript || '',
    fileSize: fileSize,
    isPrivate: true,
    mimeType: 'text/plain',
    subApp: 'transcript',
    channelRef,
    conversationId
  };
};

export const mapRCA = (args: RCAWithRelations): VespaFileDocument => {
  const chunks: string[] = [];

  if (args.title) chunks.push(`Title: ${args.title}`);
  if (args.summary) chunks.push(`Summary: ${args.summary}`);
  if (args.rootCause) chunks.push(`Root Cause: ${args.rootCause}`);
  if (args.severity) chunks.push(`Severity: ${args.severity}`);
  if (args.bugTypeId) chunks.push(`Bug Type: ${args.bugTypeId}`);
  if (args.categoryTypeId) chunks.push(`Category Type: ${args.categoryTypeId}`);
  if (args.issueStartAt) chunks.push(`Issue Start Time: ${new Date(args.issueStartAt).toISOString()}`);

  args.impacts?.forEach((impact, idx) => {
    chunks.push(`Impact ${idx + 1}: ${impact.impact}`);
  });

  args.coes?.forEach((coe, idx) => {
    chunks.push(`COE Action ${idx + 1}: ${coe.action}`);
  });

  const chunks_pos = chunks.map((_, i) => String(i));

  return {
    docType: VespaDocType.FILE,
    docId: args.id,
    fileName: `RCA-${args.ticketTitle || args.ticketId}`,
    description: args.summary || `Root Cause Analysis for ticket ${args.ticketTitle || args.ticketId}`,
    chunks,
    chunks_pos,
    image_chunks: [],
    image_chunks_pos: [],
    metadata: JSON.stringify({
      ticketId: args.ticketId,
      status: args.status,
      impactCount: args.impacts?.length || 0,
      coeCount: args.coes?.length || 0,
    }),
    createdBy: args.ownerId,
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
    ownerId: args.ownerId,
    permissions: [],
    urlInternal: `/rca/${args.id}`,
    urlOriginal: `/rca/${args.id}`,
    fileSize: 0,
    isPrivate: false,
    mimeType: 'text/markdown',
    subApp: SubApp.RCA,
  };
};

export const mapBySchema = async (
  schemaName: VespaSchema,
  args: VespaPayload,
  jobType: VespaJobType,
  app?: SubApp
): Promise<InsertDocument | Partial<InsertDocument>> => {
  const docType = schemaToDocType[schemaName];
  if (!docType) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  if (jobType === 'feed') {
    switch (schemaName) {
      case channelSchema:
        return mapChannel(args as InsertValue<ChannelsSchema>);
      case messageSchema:
        return mapMessage(args as InsertValue<MessagesSchema>);
      case projectSchema:
        return mapProject(args as InsertValue<ProjectsSchema>);
      case ticketSchema:
        return mapTicket(args as InsertValue<TicketsSchema>);
      case fileSchema:
        if (!app) {
          throw new Error(`${schemaName}: fileSchema requires 'app' parameter to determine mapper (CANVAS, TRANSCRIPT, or RCA)`);
        }
        switch (app) {
          case SubApp.CANVAS:
            return mapCanvas(args as InsertValue<CanvasesSchema>);
          case SubApp.TRANSCRIPT:
            return mapTranscript(args as InsertValue<TranscriptsSchema>);
          case SubApp.RCA:
            return mapRCA(args as RCAWithRelations);
          default:
            throw new Error(`No mapper defined for sub-app: ${app}`);
        }
      default:
        throw new Error(`Unknown schema: ${schemaName}`);
    }
  }

  if (jobType === 'update') {
    switch (schemaName) {
      case channelSchema:
        throw new Error(`${schemaName}:Schema not defined for update`);
      case messageSchema:
        throw new Error(`${schemaName}:Schema not defined for update`);
      case projectSchema:
        throw new Error(`${schemaName}:Schema not defined for update`);
      case ticketSchema:
        throw new Error(`${schemaName}:Schema not defined for update`);
      default:
        throw new Error(`Unknown schema: ${schemaName}`);
    }
  }
  throw new Error(`Unknown job type: ${jobType}`);
}

export const queueVespaJob = (schema: VespaSchema, jobType: VespaJobType, data: InsertDocument | Partial<InsertDocument>): VespaJob => ({
  schema,
  jobType,
  docId: data.docId || "",
  data
})

export const fetchDataBySchema = async (
  schema: VespaSchema,
  docId: string,
  app?: SubApp
): Promise<Channel | Message | Project | Ticket | RCAWithRelations | Canvas | Call | null> => {
  switch (schema) {
    case channelSchema:
      return await db.channel.findUnique({
        where: { id: docId }
      });

    case messageSchema:
      return await db.message.findUnique({
        where: { messageId: docId }
      });

    case projectSchema:
      return await db.project.findUnique({
        where: { id: docId }
      });

    case ticketSchema:
      return await db.ticket.findUnique({
        where: { id: docId }
      });

    case fileSchema:
      if (!app) {
        throw new Error(`${schema}: fileSchema requires 'app' parameter to determine fetcher (CANVAS, TRANSCRIPT, or RCA)`);
      }
      switch (app) {
        case SubApp.CANVAS:
          return await db.canvas.findUnique({
            where: { id: docId }
          });
        case SubApp.TRANSCRIPT:
          return await db.call.findUnique({
            where: { id: docId }
          });
        case SubApp.RCA:
          const releaseRepository = new ReleaseRepository();
          return await releaseRepository.getRCAById(docId, { includeImpacts: true, includeCOEs: true }) as RCAWithRelations;
        default:
          throw new Error(`No fetcher defined for sub-app: ${app}`);
      }

    default:
      throw new Error(`Unknown schema: ${schema}`);
  }
}

export const fetchAndMapBySchema = async (
  schema: VespaSchema,
  docId: string,
  jobType: VespaJobType,
  app?: SubApp,
): Promise<InsertDocument | Partial<InsertDocument>> => {

  if (jobType === 'delete') {
    const docType = schemaToDocType[schema];
    if (!docType) {
      throw new Error(`Unknown schema: ${schema}`);
    }
    if (schema === messageSchema) {
      try {
        const vespaDoc = await vespaClient.crudService.getDocument(docId, messageSchema);
        const conversationId = vespaDoc?.fields?.threadId;
        if (conversationId) {
          await updateTicketThreadFields(conversationId);
          await mapAndUpdatePreviousMessagesMentions(docId, conversationId);
        } else {
          throw new Error(`conversationId not found for message ${docId} in Vespa`);
        }
      } catch (error) {
        throw new Error(`Failed to fetch message ${docId} from Vespa: ${error}`);
      }
    }
    return { docType, docId } as Partial<InsertDocument>;
  }

  const rawData = await fetchDataBySchema(schema, docId, app);

  if (!rawData) {
    throw new Error(`Data not found for ${schema}/${docId}`);
  }

  return await mapBySchema(schema, rawData, jobType, app);
}


export const VespaOperationType: Record<VespaJobType, VespaOpType> = {
  feed: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
}
