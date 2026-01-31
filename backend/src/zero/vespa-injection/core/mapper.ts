import { extractMentionsFromContent } from '@/utils/mentionUtils';
import { channelSchema, InsertDocument, messageSchema, projectSchema, schemaToDocType, ticketSchema, VespaChatContainerDocument, VespaChatMessageDocument, VespaDocType, VespaProjectDocument, VespaSchema, VespaTicketDocument } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';
import type { InsertValue, UpdateValue } from '@rocicorp/zero';
import { ChannelScopeType, ChannelVisibility, TicketStatus, TicketStatusV2, type Schema } from '@xyne/shared';
import { convert } from 'html-to-text';
import { VespaJob, VespaJobType, VespaPayload } from './types';
import { db } from '@/database/client';
import { Conversation, Channel, Message, Project, Ticket, VespaOperationType as VespaOpType } from '@prisma/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import vespaClient from '@/vespa/client';
import { messageSignalService } from '@/services/personalization';
import {logger} from '@/utils/logger';

type ChannelsSchema = Schema['tables']['channels'];
type MessagesSchema = Schema['tables']['messages'];
type ProjectsSchema = Schema['tables']['projects'];
type TicketsSchema = Schema['tables']['tickets'];

const getRef = (schema: VespaSchema, docId: string) => `id:${NAMESPACE}:${schema}::${docId}`

/**
 * Convert timestamp to number (Unix timestamp in milliseconds)
 * Handles both string dates and number timestamps
 */
const toTimestamp = (timestamp: Date | string | number | null | undefined): number => {
  if (!timestamp) return 0;
  return typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
}

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

  let channelName = args.name
  if (args.scopeType === ChannelScopeType.DM || args.scopeType === ChannelScopeType.GROUP_DM) {
    const userIds = args.name.split(",")
    const usernames = await db.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });

    channelName = usernames.map(u => u.name).join(",")
  }
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

export const mapUpdateChannel = async (
  args: UpdateValue<ChannelsSchema>,
): Promise<Partial<VespaChatContainerDocument>> => {
  const channelParticipants = await db.channelParticipant.findMany({
    where: { channelId: args.id }
  });
  let channelName = args.name
  if (args.scopeType && args.name && (args.scopeType === ChannelScopeType.DM || args.scopeType === ChannelScopeType.GROUP_DM)) {
    const userIds = args.name.split(",")
    const usernames = await db.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });

    channelName = usernames.map(u => u.name).join(",")
  }

  const existingChannel = await db.channel.findUnique({
    where: { id: args.id },
    select: { name: true },
  });

  if (channelName !== undefined && existingChannel?.name !== channelName) {
      await updateChannelNameInPreviousMessages(args.id, channelName);
  }

  return {
    ...(args.name !== undefined && { channelName }),
    ...(args.description !== undefined && args.description !== null && { description: args.description }),
    ...(args.updatedAt !== undefined && { updatedAt: args.updatedAt }),
    ...(args.visibility !== undefined && {
      visibility: args.visibility,
      isPrivate: args.visibility === ChannelVisibility.PRIVATE
    }),
    ...(args.scopeType !== undefined && {
      scopeType: args.scopeType,
      isIm: args.scopeType === ChannelScopeType.DM,
      isMpim: args.scopeType === ChannelScopeType.GROUP_DM
    }),
    ...(args.metadata !== undefined && { metadata: JSON.stringify(args.metadata) }),
    ...(args.lastActivityAt !== undefined && {
      lastActivityAt: toTimestamp(args.lastActivityAt),
      lastSyncedAt: toTimestamp(args.lastActivityAt)
    }),
    ...(channelParticipants.length > 0 && {
      permissions: channelParticipants.map(p => p.userId),
      memberCount: channelParticipants.length
    })
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
  args: InsertValue<MessagesSchema> | UpdateValue<MessagesSchema>,
  msgMentions: string[],
): Promise<{ aggregatedMentions: string[], threadSenderNames: string[] }> => {

  const senderId = args.senderId || '';

  const messages = await db.message.findMany({
    where: { conversationId: args.conversationId },
  });

  const filteredMessages = messages.filter(m => m.messageId !== args.messageId);
  if (filteredMessages.length === 0) {
    const sender = await db.user.findUnique({
      where: { id: senderId }
    })
    return { aggregatedMentions: [...msgMentions], threadSenderNames: sender ? [sender.name] : [] };
  }

  const mentionsPerMessage = await Promise.all(
    filteredMessages.map(m => extractMentionsFromContent(m.content))
  );

  const aggregatedMentions = mentionsPerMessage.flatMap(
    mentions => mentions?.map(v => v.username) || []
  );

  aggregatedMentions.push(...msgMentions);

  const senderIds = filteredMessages.flatMap(
    msg => msg.senderId).concat(senderId)
    ;

  const senders = await db.user.findMany({
    where: {
      id: {
        in: senderIds,
      },
    },
  });

  const threadSenderNames = filteredMessages.flatMap(message => {
    const sender = senders.find(user => user.id === message.senderId);
    return sender ? sender.name : [];
  });

  const currentSender = senders.find(user => user.id === senderId);
  if (currentSender) {
    threadSenderNames.push(currentSender.name);
  }

  await Promise.all(
    filteredMessages.map(message =>
      vespaClient.crudService.update(
        message.messageId,
        {
          docType: VespaDocType.MESSAGE,
          docId: message.messageId,
          threadMentions: aggregatedMentions,
          threadSenders: threadSenderNames,
        },
        messageSchema,

      )
    )
  );

  return { aggregatedMentions, threadSenderNames };
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

  let msgChannelName = msgChannel?.name;
  let channelScopeType = msgChannel?.scopeType;
  if (channelScopeType && msgChannelName && (channelScopeType === ChannelScopeType.DM || channelScopeType === ChannelScopeType.GROUP_DM)) {
    const userIds = msgChannelName.split(",")
    const usernames = await db.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });

    msgChannelName = usernames.map(u => u.name).join(",")
  }

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

  const threadInfo = await mapAndUpdatePreviousMessagesMentions(args, mentions?.map(v => v.username) || []);

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
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.createdAt),
    deletedAt: 0,
    channelRef: getRef(channelSchema, conversation.channelId),
    threadId: args.conversationId,
    channelWeightedSet: {
      [`channel:${conversation.channelId}`]: 1
    },
    userWeightedSet:{
      [`user:${args.senderId}`] : 1
    },
    attachmentIds: attachments.map(a => a.entityId),
    reactions: 0, // TODO
    replyCount: conversation.replyCount || 0,
    replyUsersCount: 0, // TODO
    mentions: mentions?.map(v => v.username) || [],
    metadata: JSON.stringify(args.metadata || {}),
    threadMentions: threadInfo.aggregatedMentions,
    threadSenders: threadInfo.threadSenderNames,
    messageChannelName: msgChannelName || '',
    messageType: args.msgType || 'USER',
  }
}

export const mapUpdateMessage = async (
  args: UpdateValue<MessagesSchema>
): Promise<Partial<VespaChatMessageDocument>> => {
  const updates: Partial<VespaChatMessageDocument> = {
    docType: VespaDocType.MESSAGE,
    docId: args.messageId,
  }

  // Handle content update - need to regenerate text and mentions
  if (args.content !== undefined) {
    const mentions = await extractMentionsFromContent(args.content)
    const messageContent = convert(args.content || '', { wordwrap: false }) || ''

    updates.text = messageContent
    updates.mentions = mentions?.map(v => v.username) || []
  }

  // Handle metadata updates
  if (args.metadata !== undefined) {
    updates.metadata = JSON.stringify(args.metadata)
  }

  // Handle conversationId change (if messages can be moved between conversations)
  if (args.conversationId !== undefined) {
    const conversation = await db.conversation.findUnique({
      where: { conversationId: args.conversationId }
    });

    if (conversation?.channelId) {
      updates.channelRef = getRef(channelSchema, conversation.channelId)
      updates.threadId = args.conversationId
      updates.replyCount = conversation.replyCount || 0
    }
  }

  // Handle attachment updates
  if (args.conversationId && args.conversationId !== undefined) {
    const attachments = await db.messageAttachment.findMany({
      where: { conversationId: args.conversationId }
    });

    if (attachments.length > 0) {
      updates.attachmentIds = attachments.map(a => a.entityId)
    }
  }

  const threadInfo = await mapAndUpdatePreviousMessagesMentions(args, updates.threadMentions || []);
  updates.threadMentions = threadInfo.aggregatedMentions;
  updates.threadSenders = threadInfo.threadSenderNames;

  return updates
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

export const mapUpdateProject = (
  args: UpdateValue<ProjectsSchema>,
): Partial<VespaProjectDocument> => {
  const updates: Partial<VespaProjectDocument> = {
    docType: VespaDocType.PROJECT,
    docId: args.id,
  }

  if (args.name !== undefined) {
    updates.name = args.name
  }

  if (args.description !== undefined) {
    updates.description = args.description || ""
  }

  if (args.updatedAt !== undefined) {
    updates.updatedAt = toTimestamp(args.updatedAt)
  }

  if (args.updatedBy !== undefined) {
    updates.updatedBy = args.updatedBy || ""
  }

  return updates
}

export const mapTicket = async (args: InsertValue<TicketsSchema>): Promise<VespaTicketDocument> => {
  const [
    conversation,
    attachments,
    parentTicket
  ] = await Promise.all([
    db.conversation.findUnique({
      where: { conversationId: args.conversationId }
    }),
    db.messageAttachment.findMany({
      where: { conversationId: args.conversationId }
    }),
    db.subTicket.findFirst({
      where: { mappedTicketId: args.id }
    })
  ])

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
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
    closedAt: toTimestamp(args.closedAt),
    deletedAt: toTimestamp(args.closedAt), // TODO get the deletedAT
    parentTicketId: parentTicket?.mappedTicketId || "",
    boardId: args.boardId,
    attachmentIds: attachments.map(a => a.id),
    metadata: JSON.stringify(args.metadata)
  }
}

export const mapUpdateTicket = async (
  args: UpdateValue<TicketsSchema>
): Promise<Partial<VespaTicketDocument>> => {
  const updates: Partial<VespaTicketDocument> = {
    docType: VespaDocType.TICKET,
    docId: args.id,
  }

  if (args.conversationId !== undefined) {
    const [conversation, attachments] = await Promise.all([
      db.conversation.findUnique({
        where: { conversationId: args.conversationId }
      }),
      db.messageAttachment.findMany({
        where: { conversationId: args.conversationId }
      }),
    ])

    updates.convId = args.conversationId
    updates.threadId = args.conversationId
    if (conversation?.channelId) {
      updates.channelRef = getRef(channelSchema, conversation.channelId)
    }
    updates.attachmentIds = attachments.map(a => a.id)
  }

  if (args.userGroupId !== undefined) {
    updates.userGroupId = args.userGroupId
  }

  if (args.projectId !== undefined) {
    updates.projectRef = getRef(projectSchema, args.projectId)
  }

  if (args.statusV2 !== undefined) {
    updates.status = args.statusV2 as TicketStatusV2
  } else if (args.status !== undefined) {
    // Fallback: map old status to new statusV2
    updates.status = mapStatusToStatusV2(args.status as TicketStatus)
  }

  if (args.assignedTo !== undefined) {
    updates.assignedTo = args.assignedTo || ""
  }

  if (args.closedBy !== undefined) {
    updates.closedBy = args.closedBy || ""
  }

  if (args.title !== undefined) {
    updates.title = args.title
  }

  if (args.description !== undefined) {
    updates.description = args.description
  }

  if (args.priority !== undefined) {
    updates.priority = args.priority
  }

  if (args.stageName !== undefined) {
    updates.stage = args.stageName
  }

  if (args.updatedAt !== undefined) {
    updates.updatedAt = toTimestamp(args.updatedAt)
  }

  if (args.closedAt !== undefined) {
    updates.closedAt = toTimestamp(args.closedAt)
    updates.deletedAt = toTimestamp(args.closedAt)
  }

  if (args.boardId !== undefined) {
    updates.boardId = args.boardId
  }

  if (args.metadata !== undefined) {
    updates.metadata = JSON.stringify(args.metadata)
  }

  // Check if parent ticket relationship changed
  const parentTicket = await db.subTicket.findFirst({
    where: { mappedTicketId: args.id }
  });

  if (parentTicket) {
    updates.parentTicketId = parentTicket.mappedTicketId || ""
  }

  return updates
}


export const mapBySchema = async (
  schemaName: VespaSchema,
  args: VespaPayload,
  jobType: VespaJobType
): Promise<InsertDocument | Partial<InsertDocument>> => {
  const docType = schemaToDocType[schemaName];
  if (!docType) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  if (jobType === 'delete') {
    const docId = schemaName === messageSchema && 'messageId' in args
      ? args.messageId
      : 'id' in args
        ? args.id
        : undefined;

    if (!docId) {
      throw new Error(`Missing docId for delete operation on ${schemaName}`);
    }

    return { docType, docId } as Partial<InsertDocument>
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
      default:
        throw new Error(`Unknown schema: ${schemaName}`);
    }
  }

  if (jobType === 'update') {
    switch (schemaName) {
      case channelSchema:
        return mapUpdateChannel(args as UpdateValue<ChannelsSchema>);
      case messageSchema:
        return mapUpdateMessage(args as UpdateValue<MessagesSchema>);
      case projectSchema:
        return mapUpdateProject(args as UpdateValue<ProjectsSchema>);
      case ticketSchema:
        return mapUpdateTicket(args as UpdateValue<TicketsSchema>);
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
): Promise<Channel | Message | Project | Ticket | null> => {
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

    default:
      throw new Error(`Unknown schema: ${schema}`);
  }
}

export const fetchAndMapBySchema = async (
  schema: VespaSchema,
  docId: string,
  jobType: VespaJobType
): Promise<InsertDocument | Partial<InsertDocument>> => {
  if (jobType === 'delete') {
    const docType = schemaToDocType[schema];
    if (!docType) {
      throw new Error(`Unknown schema: ${schema}`);
    }
    return { docType, docId } as Partial<InsertDocument>;
  }

  const rawData = await fetchDataBySchema(schema, docId);

  if (!rawData) {
    throw new Error(`Data not found for ${schema}/${docId}`);
  }

  return await mapBySchema(schema, rawData, jobType);
}


export const VespaOperationType: Record<VespaJobType, VespaOpType> = {
  feed: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
}
