import { extractMentionsFromContent } from '@/utils/mentionUtils';
import { extractChannelMentions } from '@/utils/mentionParser';
import { appSchema, callSchema, channelSchema, InsertDocument, mailSchema, messageSchema, projectSchema, schemaToDocType, SubApp, ticketSchema, userSchema, VespaAppDocument, VespaCallDocument, VespaChatContainerDocument, VespaChatMessageDocument, VespaDocType, VespaFileDocument, VespaMailDocument, VespaProjectDocument, VespaSchema, VespaTicketDocument, samTranscriptSchema } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';
import type { InsertValue } from '@rocicorp/zero';
import {
  CanvasVisibility,
  ChannelScopeType,
  ChannelVisibility,
  TicketStatus,
  TicketStatusV2,
  type Schema,
  AttachmentEntityType,
  VespaOperationType as VespaOpType,
} from '@xyne/shared';
import { FormFieldType } from '@xyne/shared';
import { indexableTagNames, parseAppliedTags } from '@xyne/shared';
import { VespaJobType, VespaPayload } from './types';
import { db } from '@/database/client';
import {
  Channel,
  Message,
  Project,
  Ticket,
  Email,
  User,
  Canvas,
  Call,
  CollectionItem,
  Apps,
} from '@prisma/client';
import { FileProcessor } from '@/services/fileProcessor';
import { transformUserToVespa } from '@/services/vespaTransformers';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { getFlowJsonContentForNotification } from '@/zero/side-effects/tables/messages-handler';
import { extractLinksFromContent } from '@/utils/urlUtils';
import vespaClient from '@/vespa/client';
import { messageSignalService } from '@/services/personalization';
import { logger } from '@/utils/logger';
import { RCAWithRelations, ReleaseRepository } from '@/database/repositories/releaseRepository';
import { fileSchema } from '@xyne/vespa-ts';
import { config } from '@/config/env';
import { TextStrategy } from '../strategies/TextStrategy';
import { getStorageService } from '@/services/storage';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { buildFormFields, type TicketDynamicFieldValue } from './form-fields';
import { DESK_EMAIL_SOURCE_TYPE } from '@/tags';

type ChannelsSchema = Schema['tables']['channels'];
type MessagesSchema = Schema['tables']['messages'];
type ProjectsSchema = Schema['tables']['projects'];
type TicketsSchema = Schema['tables']['tickets'];
type CanvasesSchema = Schema['tables']['canvases'];
type TranscriptsSchema = Schema['tables']['calls'];
type MessageAttachmentsSchema = Schema['tables']['message_attachments'];

const loadTicketFormFields = async (ticketId: string) => {
  const formEntityValues = await db.formEntityValues.findMany({
    where: {
      entityId: ticketId,
      entityType: 'TICKET',
    },
    select: {
      fieldId: true,
      actualFieldValue: true,
    },
  }) as TicketDynamicFieldValue[];

  const fieldIds = [...new Set(formEntityValues.map(value => value.fieldId))];
  const formFieldRows = fieldIds.length > 0
    ? await db.formFields.findMany({
      where: {
        id: { in: fieldIds },
      },
      select: {
        id: true,
        fieldType: true,
      },
    })
    : [];
  const fieldTypeByFieldId = new Map(
    formFieldRows.map(field => [field.id, field.fieldType as FormFieldType]),
  );

  return buildFormFields(formEntityValues, fieldTypeByFieldId);
};

const getRef = (schema: VespaSchema, docId: string) => `id:${NAMESPACE}:${schema}::${docId}`
// One-hot of the doc's channel, matched against user-doc channelWeights by the `personalized` rank profile.
const channelWeightedSetFor = (channelId: string | null | undefined) =>
  channelId ? { [`channel:${channelId}`]: 1 } : undefined;

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

  // Extract mentions from all messages - store user IDs
  const mentionsPerMessage = await Promise.all(
    messages.map(m => extractMentionsFromContent(m.content))
  ) || [];
  const threadMentions = mentionsPerMessage.flatMap(mentions => mentions?.map(v => v.userId) || []);

  // Get unique sender IDs directly from messages
  const threadSenders = [...new Set(messages.map(msg => msg.senderId))];

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

  const [{ messages, threadMentions, threadSenders }, conversation] = await Promise.all([
    getThreadInfo(conversationId),
    db.conversation.findUnique({
      where: { conversationId },
      select: { replyCount: true },
    }),
  ]);
  const replyCount = conversation?.replyCount || 0;

  if (messages.length === 0) {
    // All messages deleted - clear thread fields
    await vespaClient.crudService.update(
      [{
        docId: ticket.id,
        fields: {
          docType: VespaDocType.TICKET,
          docId: ticket.id,
          threadMentions: [],
          threadSenders: [],
          replyCount,
          initialMessage: '',
          initialMessageSender: ''
        },
      }],
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
    [{
      docId: ticket.id,
      fields: {
        docType: VespaDocType.TICKET,
        docId: ticket.id,
        threadMentions,
        threadSenders,
        replyCount,
        initialMessage,
        initialMessageSender: initialSender?.name || ''
      },
    }],
    ticketSchema
  );
};

/**
 * Resolve workspaceId and orgId for a Vespa document.
 * Tries workspaceId first, then the fallback lookup, then derives orgId from
 * the workspace table. The orgIdFallback is used when the workspace lookup also
 * yields nothing (e.g. job-param orgId passed by the caller).
 */
const resolveOrgAndWorkspace = async (
  workspaceId: string | undefined | null,
  fallback?: () => Promise<string | undefined | null>,
  orgIdFallback?: string | null
): Promise<{ workspaceId: string | undefined; orgId: string | undefined }> => {
  let wsId = workspaceId || undefined;
  if (!wsId && fallback) {
    wsId = (await fallback()) || undefined;
  }
  if (!wsId) {
    return { workspaceId: undefined, orgId: orgIdFallback || undefined };
  }
  const workspace = await db.workspace.findUnique({
    where: { id: wsId },
    select: { orgId: true },
  });
  return { workspaceId: wsId, orgId: workspace?.orgId || orgIdFallback || undefined };
};

export const mapChannel = async (
  args: InsertValue<ChannelsSchema> | Channel,
  participants?: string[],
  workspaceId?: string,
  orgId?: string
): Promise<VespaChatContainerDocument> => {
  let channelParticipants = participants
  if (!channelParticipants) {
    channelParticipants = (await db.channelParticipant.findMany({
      where: { channelId: args.id }
    })).map(v => v.userId)
  }

  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    ('workspaceId' in args && args.workspaceId) ? args.workspaceId : workspaceId,
    () => db.channel.findUnique({ where: { id: args.id }, select: { workspaceId: true } }).then(r => r?.workspaceId),
    orgId
  );
  if (!effectiveWorkspaceId) logger.warn(`[mapChannel] workspaceId not found for channel ${args.id}`);

  const channelName = await resolveChannelName(args.name, args.scopeType);
  const channelStats = await db.channelStats.findUnique({ where: { channelId: args.id } });
  const lastActivityAt = channelStats?.lastActivityAt ?? ('createdAt' in args ? args.createdAt : new Date());
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
    lastActivityAt: toTimestamp(lastActivityAt),
    lastSyncedAt: toTimestamp(lastActivityAt),
    topic: "",// TODO: handle topic,
    memberCount: channelParticipants.length,
    isArchived: false, // TODO: handle archived state
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
}
export const mapAndUpdatePreviousMessagesMentions = async (
  messageId: string,
  conversationId: string,
): Promise<{ threadMentions: string[], threadSenders: string[] }> => {
  const { messages, threadMentions, threadSenders } = await getThreadInfo(conversationId);

  const filteredMessages = messages.filter(m => m.messageId !== messageId);
  logger.info(`[MESSAGE THREAD MENTIONS UPDATE] Updating ${filteredMessages.length} messages for conversationId: ${conversationId}`);


  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { replyCount: true },
  });
  const replyCount = conversation?.replyCount || 0;

  const updates = filteredMessages.map(message => ({
    docId: message.messageId,
    fields: {
      docType: VespaDocType.MESSAGE,
      docId: message.messageId,
      threadMentions,
      threadSenders,
      replyCount,
    },
  }));

  const results = await vespaClient.crudService.update(updates, messageSchema);
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    logger.error(`[MESSAGE THREAD MENTIONS UPDATE] ${failed.length}/${results.length} updates failed for conversationId: ${conversationId}`);
  }

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
      where: {
        entityId: args.messageId,
        entityType: AttachmentEntityType.CHAT,
      },
    }),
  ])

  // Bot messages carry FlowJSON, whose text lives in the component tree — the
  // HTML only holds a fallback label ("Flow JSON"), so html-to-text would index
  // that instead of the message. Reuses the same extraction the notification
  // path uses; plain HTML content falls through unchanged.
  const messageContent =
    getFlowJsonContentForNotification(args.content || '') ||
    extractPlainTextFromHtml(args.content || '') || '';

  const messageLinks = extractLinksFromContent(args.content || '');

  const threadInfo = await mapAndUpdatePreviousMessagesMentions(args.messageId, args.conversationId);

  // Tag names, denormalized onto the doc so search can filter on them. Everything on the
  // thread is indexed as soon as it lands — classifier or person, vocabulary or free-form —
  // minus anything removed.
  //
  // messageActs holds the thread types this message is the EVIDENCE for: the classifier
  // cites a message per type, and that citation is stored on both sides.
  const messageActs = indexableTagNames(parseAppliedTags(args.messageActs));
  const threadType = indexableTagNames(parseAppliedTags(conversation.threadType));

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
    chunks: chunkPlainText(messageContent),
    links: messageLinks,
    hasLinks: messageLinks.length > 0,
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
    isRootMessage: args.messageId === conversation.initialMessageId,
    messageActs,
    // Only the root message carries the thread's types — one doc to refeed when they
    // change rather than the whole thread. Free-form tags are indexed alongside the
    // built-in vocabulary, so both are searchable.
    ...(args.messageId === conversation.initialMessageId && threadType.length > 0
      ? { threadType }
      : {}),
    channelWeightedSet: {
      [`channel:${conversation.channelId}`]: 1
    },
    userWeightedSet: {
      [`user:${args.senderId}`]: 1
    },
    attachmentIds: attachments.map(a => a.id),
    reactions: 0, // TODO
    replyCount: conversation.replyCount || 0,
    replyUsersCount: 0, // TODO
    mentions: mentions?.map(v => v.userId) || [],
    channelMentions: extractChannelMentions(args.content || ''),
    metadata: JSON.stringify(args.metadata || {}),
    threadMentions: threadInfo.threadMentions,
    threadSenders: threadInfo.threadSenders,
    messageChannelName: msgChannelName || '',
    messageType: args.msgType || 'USER',
  }
}


export const mapProject = async (args: InsertValue<ProjectsSchema>, workspaceId?: string, orgId?: string): Promise<VespaProjectDocument> => {
  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    ('workspaceId' in args && args.workspaceId) ? args.workspaceId : workspaceId,
    () => db.project.findUnique({ where: { id: args.id }, select: { workspaceId: true } }).then(r => r?.workspaceId),
    orgId
  );
  return {
    docId: args.id,
    docType: VespaDocType.PROJECT,
    name: args.name,
    description: args.description || "",
    createdBy: args.createdBy,
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
    updatedBy: args.updatedBy || "",
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
}

/**
 * Map an `apps` row to its Vespa document. orgId/scope/version come straight off
 * the app row and drive the view filters (Org = orgId+scope ORG, Marketplace =
 * scope GLOBAL). orgName is the owning org's display name — it mirrors the UI's
 * "Created by" fallback for cross-org marketplace apps and is lexically searchable.
 * creator identity + workspaceId are denormalized from the creator's user record.
 * name + description are embedded inside Vespa at feed time; creator/org fields are
 * lexical-only.
 */
export const mapApp = async (args: Apps): Promise<VespaAppDocument> => {
  const [creator, org] = await Promise.all([
    db.user.findUnique({
      where: { id: args.createdBy },
      select: { name: true, email: true, workspaceId: true },
    }),
    db.organization.findUnique({
      where: { orgId: args.orgId },
      select: { name: true },
    }),
  ]);
  return {
    docId: args.id,
    docType: VespaDocType.APP,
    workspaceId: creator?.workspaceId ?? '',
    orgId: args.orgId,
    scope: args.scope,
    version: args.version,
    name: args.name,
    description: args.description ?? '',
    createdBy: args.createdBy,
    creatorName: creator?.name ?? '',
    creatorEmail: creator?.email ?? '',
    orgName: org?.name ?? '',
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.updatedAt),
  };
};


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
    descriptionMentions,
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
      select: { name: true, code: true }
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
    extractMentionsFromContent(args.description),
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
  const vespaFormFields = await loadTicketFormFields(args.id);

  // Our tag-generation framework's tags, sourced from the latest email in this
  // ticket's conversation (the framework only tags desk-email, not tickets directly).
  let generatedTags: string[] = [];
  if (args.conversationId) {
    const latestEmail = await db.email.findFirst({
      where: { conversationId: args.conversationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (latestEmail) {
      const emailTagRows = await db.tag.findMany({
        where: { sourceId: latestEmail.id, sourceType: DESK_EMAIL_SOURCE_TYPE, isDeleted: false, workspaceId: args.workspaceId },
        select: { tag: true, tagCategory: true },
      });
      generatedTags = emailTagRows.map(t => `${t.tagCategory}:${t.tag}`);
    }
  }

  return {
    docId: args.id,
    docType: VespaDocType.TICKET,
    convId: args.conversationId,
    userGroupId: args.userGroupId,
    channelRef: getRef(channelSchema, conversation?.channelId || ""),// if there is no channelId we can refer it with projectRef
    channelWeightedSet: channelWeightedSetFor(conversation?.channelId),
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
    chunks: chunkPlainText(extractPlainTextFromHtml(args.description || '')),
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
    formFields: vespaFormFields,
    eta: toDateString(args.eta),
    channelName: resolvedChannelName,
    boardName: board?.name || '',
    xyneId: args.xyneId,
    tags: tags.map(t => t.name),
    generatedTags,
    createdByName: createdByUser?.name || '',
    assignedToName: assignedToUser?.name || '',
    closedByName: closedByUser?.name || '',
    projectName: project?.name || '',
    projectCode: project?.code || '',
    ticketMentions: descriptionMentions?.map(v => v.username) || [],
    threadMentions: threadMentions,
    threadSenders: threadSenders,
    replyCount: conversation?.replyCount || 0,
    initialMessage: initialMessage,
    initialMessageSender: initialMessageSender,
    parentTicketXyneId: parentTicketXyneId,
    childTicketXyneIds: childTicketXyneIds,
  }
}

export const mapCollection = async (
  args: CollectionItem,
  // When provided (e.g. from the async OCR scheduler's writer), skip the
  // synchronous FileProcessor parse and use these pre-computed chunks instead.
  // All permission/owner/scope resolution below is reused unchanged.
  override?: {
    chunks: string[];
    chunks_pos: string[];
    chunks_map?: any[];
    image_chunks: string[];
    image_chunks_pos: string[];
    image_chunks_map?: any[];
    documentOutline?: string;
  },
): Promise<VespaFileDocument> => {
  const collectionItem = await db.collectionItem.findUnique({
    where: { id: args.id },
  });

  const attachment = collectionItem
    ? await db.messageAttachment.findFirst({
        where: { entityId: collectionItem.id, entityType: AttachmentEntityType.COLLECTION },
      })
    : null;

  if (!collectionItem) {
    throw new Error(`CollectionItem not found: ${args.id}`);
  }

  // Always resolve isPrivate and permissions from the ROOT collection.
  // collectionId may point to a sub-folder whose isPrivate/permissions are not authoritative.
  const rootCollection = await db.collection.findUnique({
    where: { id: collectionItem.rootCollectionId },
    include: { permissions: true },
  });

  if (!rootCollection) {
    throw new Error(`Root collection not found: ${collectionItem.rootCollectionId}`);
  }

  // Resolve permissions from the root collection (ownerId covered by YQL: ownerId contains userId)
  const permissions = rootCollection.permissions
    .map(p => p.userId)
    .filter((id): id is string => id !== null);

  // Process file: fetch from GCS and extract chunks using FileProcessor
  let chunks: string[] = [];
  let chunks_pos: string[] = [];
  let image_chunks: string[] = [];
  let image_chunks_pos: string[] = [];
  let chunks_map: any[] | undefined;
  let documentOutline: string | undefined;

  if (override) {
    // Async OCR scheduler path — chunks already produced by the OCR fleet.
    chunks = override.chunks;
    chunks_pos = override.chunks_pos;
    chunks_map = override.chunks_map;
    image_chunks = override.image_chunks;
    image_chunks_pos = override.image_chunks_pos;
    documentOutline = override.documentOutline;
  } else if (attachment?.url) {
    try {
      const storageService = getStorageService();
      const buffer = await storageService.getFileBuffer(attachment!.url);

      // Multi-engine fallback ladder (PDFs: Docling/Paddle → Gemini → PdfJs;
      // other types: Docling → local strategy).
      const result = await FileProcessor.processBufferWithFallback(
        buffer,
        collectionItem.id,
        attachment?.originalFilename || 'file',
        attachment?.mimetype || '',
      );

      chunks = result.chunks || [];
      chunks_pos = result.chunks_pos
        ? result.chunks_pos.map(String)
        : chunks.map((_, index) => String(index));
      image_chunks = result.image_chunks || [];
      image_chunks_pos = (result.image_chunks_pos || []).map(String);
      chunks_map = result.chunks_map;
      documentOutline = result.documentOutline;

      logger.info(`[MAP_FILE] Processed file ${collectionItem.name} (${collectionItem.id}): ${chunks.length} chunks, ${image_chunks.length} image chunks, method: ${result.processingMethod}`);
    } catch (error) {
      logger.error(`[MAP_FILE] Failed to process file ${collectionItem.name} (${collectionItem.id}):`, error);
      // Still insert the document with empty chunks so it's searchable by metadata
    }
  }

  // Resolve projectId, channelRef, workspaceId and orgId from scope.
  // For scopeType = 'CHANNEL', look up the channel to derive these.
  // Future scope types add branches here — no schema change needed.
  let projectId: string | undefined;
  let channelRef: string | undefined;
  let workspaceId: string | undefined;
  let orgId: string | undefined;
  if (rootCollection.scopeType === 'CHANNEL') {
    const channel = await db.channel.findUnique({
      where: { id: rootCollection.scopeId },
      select: { projectId: true, workspaceId: true },
    });
    projectId = channel?.projectId ?? undefined;
    channelRef = getRef(channelSchema, rootCollection.scopeId);
    const resolved = await resolveOrgAndWorkspace(channel?.workspaceId);
    workspaceId = resolved.workspaceId;
    orgId = resolved.orgId;
  }

  return {
    docId: collectionItem.fileId,
    docType: VespaDocType.FILE,
    fileName: collectionItem.name,
    description: '',
    chunks,
    chunks_pos,
    chunks_map,
    image_chunks,
    image_chunks_pos,
    // NOTE: the Vespa `file` schema has no `image_chunks_map` field — do not send it.
    documentOutline,
    metadata: '{}',
    createdBy: collectionItem.uploadedById || collectionItem.ownerId,
    createdAt: toTimestamp(collectionItem.createdAt),
    updatedAt: toTimestamp(collectionItem.updatedAt),
    ownerId: collectionItem.ownerId,
    permissions,
    urlInternal: attachment?.url || '',
    urlOriginal: '',
    fileSize: Number(attachment?.size || 0),
    isPrivate: rootCollection.isPrivate,
    mimeType: attachment?.mimetype || '',
    subApp: 'collections',
    clId: collectionItem.rootCollectionId,
    clFd: collectionItem.collectionId,
    projectId,
    channelRef,
    channelWeightedSet: channelWeightedSetFor(rootCollection.scopeType === 'CHANNEL' ? rootCollection.scopeId : undefined),
    workspaceId,
    orgId,
  };
}

/**
 * Compute the flattened `permissions` (user IDs) for a canvas: the direct-user shares
 * plus the expanded members of every channel and user-group the canvas is shared to.
 *
 * This denormalizes the canvas ACL into the Vespa `permissions` field so cmdK matches
 * it with a single `permissions contains <userId>` — no query-time join. It mirrors the
 * DB-side `applyCanvasVisibilityQueryFilter` (owner/public are handled separately via
 * ownerId/isPrivate). Kept fresh by re-feeding on share changes and by field-scoped
 * updates when channel/group membership changes (see the side-effect fan-out).
 */
export const computeCanvasPermissions = async (canvasId: string): Promise<string[]> => {
  const participants = await db.canvasParticipant.findMany({ where: { canvasId } });

  const directUserIds = participants.map(p => p.userId).filter((id): id is string => Boolean(id));
  const channelIds = participants.map(p => p.channelId).filter((id): id is string => Boolean(id));
  const groupIds = participants.map(p => p.userGroupId).filter((id): id is string => Boolean(id));

  const [channelMembers, groupMembers] = await Promise.all([
    channelIds.length
      ? db.channelParticipant.findMany({ where: { channelId: { in: channelIds } }, select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
    groupIds.length
      ? db.userGroupMapping.findMany({ where: { userGroupId: { in: groupIds } }, select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
  ]);

  return Array.from(new Set([
    ...directUserIds,
    ...channelMembers.map(m => m.userId),
    ...groupMembers.map(m => m.userId),
  ].filter((id): id is string => Boolean(id))));
};

export const mapCanvas = async (args: InsertValue<CanvasesSchema>, workspaceId?: string, orgId?: string): Promise<VespaFileDocument> => {
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

  // Denormalized ACL: direct users + members of every channel/group the canvas is shared to.
  const permissions = await computeCanvasPermissions(args.id);

  const channel = args.channelId ? (await db.channel.findUnique({
    where: { id: args.channelId }
  })) : undefined;

  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    workspaceId,
    () => Promise.resolve(channel?.workspaceId),
    orgId
  );

  return {
    docId: args.id,
    docType: VespaDocType.FILE,
    fileName: args.title || 'Untitled Canvas',
    description: `Canvas document in ${channel?.name || 'Unknown Channel'}`,
    chunks: chunks,
    chunks_pos: chunks.map((_, index) => String(index)),
    image_chunks: [],
    image_chunks_pos: [],
    metadata: JSON.stringify({
      channelId: args.channelId,
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
    isPrivate: args.visibility !== CanvasVisibility.PUBLIC,
    mimeType: 'application/json',
    subApp: SubApp.CANVAS,
    channelRef,
    channelWeightedSet: channelWeightedSetFor(args.channelId),
    conversationId: undefined,
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
};

export const mapTranscript = async (args: InsertValue<TranscriptsSchema>, workspaceId?: string, orgId?: string): Promise<VespaFileDocument> => {
  // Get conversation and channel info from call data
  let channelRef: string | undefined;
  let conversationId: string | undefined;

  // Get channel info directly from call's channelId
  if (args.channelId) {
    channelRef = getRef(channelSchema, args.channelId);
  }

  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    workspaceId,
    args.channelId ? () => db.channel.findUnique({ where: { id: args.channelId! }, select: { workspaceId: true } }).then(r => r?.workspaceId) : undefined,
    orgId
  );

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
      const storageService = getStorageService(config.gcs.transcriptionBucketName);
      const buffer = await storageService.getFileBuffer(gcsPath);
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
    where: { callId: args.id, isExternal: false }
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
    subApp: SubApp.TRANSCRIPT,
    channelRef,
    channelWeightedSet: channelWeightedSetFor(args.channelId),
    conversationId,
    callType: args.callType,
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
};

export const mapCall = async (args: Call, workspaceId?: string, orgId?: string): Promise<VespaCallDocument> => {
  const channel = args.channelId
    ? await db.channel.findUnique({
        where: { id: args.channelId },
        select: { id: true, name: true, workspaceId: true },
      })
    : null;

  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    workspaceId,
    () => Promise.resolve(channel?.workspaceId),
    orgId,
  );

  const participants = await db.callParticipant.findMany({
    where: { callId: args.id },
    select: {
      userId: true,
      displayName: true,
      isExternal: true,
      response: true,
    },
  });

  const internalUserIds = participants
    .filter(participant => !participant.isExternal && participant.userId)
    .map(participant => participant.userId);

  const users = internalUserIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: internalUserIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const usersById = new Map(users.map(user => [user.id, user]));

  const participantNames = participants.map(participant => {
    if (participant.isExternal) return (participant.displayName || '').trim();
    return (usersById.get(participant.userId)?.name || '').trim();
  });

  const participantEmails = participants.map(participant => {
    if (participant.isExternal) return '';
    return (usersById.get(participant.userId)?.email || '').trim();
  });

  const searchableParticipantNames = participantNames.filter(Boolean);
  const searchableParticipantEmails = participantEmails.filter(Boolean);

  const displayTitle =
    args.title?.trim() ||
    channel?.name?.trim() ||
    searchableParticipantNames.slice(0, 2).join(', ') ||
    searchableParticipantEmails.slice(0, 2).join(', ') ||
    '';

  return {
    docId: args.id,
    docType: VespaDocType.CALL,
    callId: args.id,
    externalId: args.externalId,
    channelId: args.channelId || '',
    channelRef: getRef(channelSchema, args.channelId || ''),
    createdByUserId: args.createdByUserId,
    roomLink: args.roomLink || '',
    callType: args.callType,
    userIds: participants.map(participant => participant.userId || ''),
    participantResponses: participants.map(participant => String(participant.response || '')),
    title: args.title || '',
    displayTitle,
    channelName: channel?.name || '',
    participantNames,
    participantEmails,
    callOrigin: args.callOrigin,
    status: args.status,
    startsAtTimestamp: toTimestamp(args.startsAt),
    endsAtTimestamp: toTimestamp(args.endsAt),
    startedAtTimestamp: toTimestamp(args.startedAt),
    endedAtTimestamp: toTimestamp(args.endedAt),
    recurringSeriesId: args.recurringSeriesId || '',
    hasTranscript: Boolean(args.transcript),
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
};

export const mapRCA = async (args: RCAWithRelations, workspaceId?: string, orgId?: string): Promise<VespaFileDocument> => {
  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(workspaceId, undefined, orgId);
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
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
};

/**
 * Map a MessageAttachment to a VespaFileDocument
 * 
 * This function:
 * 1. Loads the file from GCS
 * 2. Parses and chunks it using the appropriate FileProcessor strategy
 * 3. Resolves the channel from the conversation
 * 4. Builds a complete VespaFileDocument for indexing
 */
export const mapFile = async (
  args: InsertValue<MessageAttachmentsSchema>,
  workspaceId?: string,
  orgId?: string,
  // When provided (async OCR scheduler's writer), skip FileProcessor and use
  // these pre-computed chunks. Permission/channel resolution below is reused.
  override?: {
    chunks: string[];
    chunks_pos: string[];
    chunks_map?: any[];
    image_chunks: string[];
    image_chunks_pos: string[];
    documentOutline?: string;
  },
  // When true, skip the GCS-download + FileProcessor content extraction and
  // return the file with empty chunks. Used by the high-priority name-only feed
  // so the file becomes searchable by name immediately; a later full feed fills
  // in content on the same docId.
  metadataOnly?: boolean,
): Promise<VespaFileDocument> => {
  // Resolve channel from conversation
  let channelRef: string | undefined;
  let channelId: string | undefined;
  let conversationId = args.conversationId || undefined;

  if (conversationId) {
    const conversation = await db.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true }
    });
    if (conversation) {
      channelId = conversation.channelId;
      channelRef = getRef(channelSchema, conversation.channelId);
    }
  }

  // Get permissions from channel participants (anyone in the channel can view files)
  let permissions: string[] = [];
  if (channelId) {
    const channelParticipants = await db.channelParticipant.findMany({
      where: { channelId },
      select: { userId: true }
    });
    permissions = channelParticipants.map(p => p.userId);
  }
  
  const channel = channelId ? (await db.channel.findUnique({
    where: { id: channelId }
  })) : undefined;

  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    ('workspaceId' in args && args.workspaceId) ? args.workspaceId : workspaceId,
    () => Promise.resolve(channel?.workspaceId),
    orgId
  );

  // If no channel participants found, fall back to conversation participants
  if (permissions.length === 0 && conversationId) {
    const participants = await db.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true }
    });
    permissions = participants.map(p => p.userId);
  }

  // Parse file content into chunks using FileProcessor
  let chunks: string[] = [];
  let fileSize = args.size || 0;
  let processingResult: any;
  if (override) {
    // Async OCR scheduler path — chunks already produced by the OCR fleet.
    chunks = override.chunks;
    processingResult = {
      chunks_pos: override.chunks_pos,
      chunks_map: override.chunks_map,
      documentOutline: override.documentOutline,
      image_chunks: override.image_chunks,
      image_chunks_pos: override.image_chunks_pos,
    };
  } else if (metadataOnly) {
    // Name-only feed: leave chunks empty and skip the GCS-download + parse.
    logger.info(`[Mapper] metadataOnly feed for file ${args.id} (${args.originalFilename}); skipping content extraction`);
  } else
  try {
    if (args.url) {
      // Extract GCS path from URL
      let gcsPath = args.url;
      if (gcsPath.startsWith('gs://')) {
        const match = gcsPath.match(/^gs:\/\/[^\/]+\/(.+)$/);
        if (match) {
          gcsPath = match[1];
        }
      } else if (gcsPath.startsWith('http')) {
        // Extract path from HTTP URL (e.g., https://storage.googleapis.com/bucket/path)
        try {
          const url = new URL(gcsPath);
          gcsPath = url.pathname.replace(/^\/[^\/]+\//, ''); // Remove /bucket/ prefix
        } catch {
          logger.warn(`[Mapper] Could not parse URL for file ${args.id}: ${gcsPath}`);
        }
      }

      const storageService = getStorageService();
      const buffer = await storageService.getFileBuffer(gcsPath);
      fileSize = buffer.length;

      // Use FileProcessor with Docling fallback support
      const result = await FileProcessor.processBufferWithFallback(
        buffer,
        args.id,
        args.originalFilename || 'file',
        args.mimetype
      );
      chunks = result.chunks;
      processingResult = result;

      logger.info(`[Mapper] Extracted ${chunks.length} chunks from file ${args.id} (${args.originalFilename}) using ${result.processingMethod}`);
    }
  } catch (error) {
    logger.error(`[Mapper] Failed to process file ${args.id} (${args.originalFilename}):`, error);
    // Continue with empty chunks - don't fail the entire operation
  }

  return {
    docId: args.id,
    docType: VespaDocType.FILE,
    fileName: args.originalFilename || 'Untitled File',
    description: `File uploaded in ${channel?.name || 'Unknown Channel'}`,
    chunks: chunks,
    chunks_pos: processingResult?.chunks_pos
      ? processingResult.chunks_pos.map(String)
      : chunks.map((_, index) => String(index)),
    chunks_map: processingResult?.chunks_map,
    image_chunks: processingResult?.image_chunks ?? [],
    image_chunks_pos: (processingResult?.image_chunks_pos ?? []).map(String),
    documentOutline: processingResult?.documentOutline,
    metadata: JSON.stringify({
      entityType: args.entityType,
      entityId: args.entityId,
      storageProvider: args.storageProvider,
      conversationId: conversationId,
      thumbnailUrl: args.thumbnailUrl,
    }),
    createdBy: args.createdBy,
    createdAt: toTimestamp(args.createdAt),
    updatedAt: toTimestamp(args.createdAt), // MessageAttachment doesn't have updatedAt
    ownerId: args.uploadedByUserId,
    permissions: permissions,
    urlInternal: args.url,
    urlOriginal: args.url,
    fileSize: fileSize,
    isPrivate: true,
    mimeType: args.mimetype,
    subApp: args.entityType === 'TICKET' ? SubApp.TICKET_ATTACHMENT : SubApp.CHAT_ATTACHMENT,
    channelRef,
    channelWeightedSet: channelWeightedSetFor(channelId),
    conversationId,
    messageId: args.entityType === 'CHAT' ? args.entityId : undefined,
    ticketId: args.entityType === 'TICKET' ? args.entityId : undefined,
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
};

/**
 * Chunk a plain-text string into segments of at most `maxLen` characters,
 * splitting on word boundaries so search snippets are coherent.
 */
const chunkPlainText = (text: string, maxLen = 1500): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.length > 0) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
};

/**
 * Map a Prisma Email record to a VespaMailDocument ready for ingestion.
 * Performs the following side-queries:
 *   1. conversation → channelId
 *   2. channelParticipant[]  → permissions (user IDs)
 *   3. externalMessage       → externalSourceId
 *   4. externalSource        → source name
 *   5. messageAttachment[]   → attachmentFilenames
 *   6. ticket form values    → indexed Desk search values
 */
export const mapEmail = async (email: Email, workspaceId?: string, orgId?: string): Promise<VespaMailDocument> => {
  // 1. Resolve conversation → channelId and linked ticket
  const conversation = await db.conversation.findUnique({
    where: { conversationId: email.conversationId },
    select: { channelId: true },
  });
  const channelId = conversation?.channelId ?? '';

  const ticket = await db.ticket.findFirst({
    where: { conversationId: email.conversationId },
    select: { id: true, xyneId: true },
  });
  const ticketFormFields = ticket ? await loadTicketFormFields(ticket.id) : [];

  const { workspaceId: effectiveWorkspaceId, orgId: effectiveOrgId } = await resolveOrgAndWorkspace(
    workspaceId,
    channelId ? () => db.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } }).then(r => r?.workspaceId) : undefined,
    orgId
  );

  // 3+4. Resolve source name via ExternalMessage → ExternalSource
  // Stays null if the lookup fails — intentional: null is visible, a hardcoded fallback is not.
  let sourceName: string | null = null;
  try {
    const externalMsg = await db.externalMessage.findFirst({
      where: { externalId: email.externalMessageId },
      select: { externalSourceId: true },
    });
    if (externalMsg?.externalSourceId) {
      const externalSource = await db.externalSource.findUnique({
        where: { id: externalMsg.externalSourceId },
        select: { name: true },
      });
      sourceName = externalSource?.name ?? null;
    } else {
      logger.warn(`[mapEmail] No ExternalMessage found for externalMessageId=${email.externalMessageId} (email ${email.id})`);
    }
  } catch (err) {
    logger.warn(`[mapEmail] Could not resolve ExternalSource for email ${email.id}: ${err}`);
  }

  // 5. Attachment filenames
  const attachments = await db.messageAttachment.findMany({
    where: { entityId: email.id, entityType: AttachmentEntityType.EMAIL },
    select: { originalFilename: true },
  });
  const attachmentFilenames = attachments
    .map(a => a.originalFilename)
    .filter((n): n is string => Boolean(n));

  // 6. Generated tags from our tag-generation framework (Tag table)
  const generatedTagRows = await db.tag.findMany({
    where: { sourceId: email.id, sourceType: DESK_EMAIL_SOURCE_TYPE, isDeleted: false, workspaceId: effectiveWorkspaceId },
    select: { tag: true, tagCategory: true },
  });
  const generatedTags = generatedTagRows.map(t => `${t.tagCategory}:${t.tag}`);

  // Build searchable chunks from plain-text body.
  // Chunks contain ONLY the body — subject is indexed separately in the `subject`
  // field, so prepending "Subject: ..." here would produce a redundant snippet
  // ("Subject: X ...") in rendered search results.
  const plainBody = extractPlainTextFromHtml(email.body || '') || email.subject;
  const chunks = chunkPlainText(plainBody);

  return {
    docId: email.id,
    docType: VespaDocType.MAIL,
    threadId: email.conversationId,
    parentThreadId: email.externalThreadId || undefined,
    mailId: email.externalMessageId || undefined,
    xyneId: ticket?.xyneId ?? undefined,
    ticketFormFields,
    ticketFormFieldValues: Array.from(new Set(ticketFormFields.map(field => field.fieldValue))),
    subject: email.subject,
    chunks,
    timestamp: toTimestamp(email.createdAt),
    /** app = source name for display/per-source filtering */
    app: sourceName,
    /** entity = "support_desk"; future: "personal" for Gmail */
    entity: 'support_desk',
    channelRef: getRef(channelSchema, channelId),
    channelWeightedSet: channelWeightedSetFor(channelId),
    from: email.from,
    to: email.to,
    cc: email.cc.length > 0 ? email.cc : undefined,
    bcc: email.bcc.length > 0 ? email.bcc : undefined,
    attachmentFilenames: attachmentFilenames.length > 0 ? attachmentFilenames : undefined,
    generatedTags,
    workspaceId: effectiveWorkspaceId,
    orgId: effectiveOrgId,
  };
};

export const mapBySchema = async (
  schemaName: VespaSchema,
  args: VespaPayload,
  jobType: VespaJobType,
  app?: SubApp,
  workspaceId?: string,
  orgId?: string,
  // Forwarded to mapFile for chat/ticket attachments: insert metadata only,
  // skipping content extraction (used by the name-only feed).
  metadataOnly?: boolean,
): Promise<InsertDocument | Partial<InsertDocument>> => {
  const docType = schemaToDocType[schemaName];
  if (!docType) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  if (jobType === 'feed') {
    switch (schemaName) {
      case channelSchema:
        return mapChannel(args as InsertValue<ChannelsSchema>, undefined, workspaceId, orgId);
      case messageSchema:
        return mapMessage(args as InsertValue<MessagesSchema>);
      case projectSchema:
        return mapProject(args as InsertValue<ProjectsSchema>, workspaceId, orgId);
      case ticketSchema:
        return mapTicket(args as InsertValue<TicketsSchema>);
      case callSchema:
        return mapCall(args as Call, workspaceId, orgId);
      case fileSchema:
        if (!app) {
          throw new Error(`${schemaName}: fileSchema requires 'app' parameter to determine mapper (CANVAS, TRANSCRIPT, RCA, or FILE)`);
        }
        switch (app) {
          case SubApp.CANVAS:
            return mapCanvas(args as InsertValue<CanvasesSchema>, workspaceId, orgId);
          case SubApp.TRANSCRIPT:
            return mapTranscript(args as InsertValue<TranscriptsSchema>, workspaceId, orgId);
          case SubApp.RCA:
            return mapRCA(args as RCAWithRelations, workspaceId, orgId);
          case SubApp.COLLECTIONS:
            return mapCollection(args as CollectionItem);
          case SubApp.CHAT_ATTACHMENT:
          case SubApp.TICKET_ATTACHMENT:
            return mapFile(args as InsertValue<MessageAttachmentsSchema>, workspaceId, orgId, undefined, metadataOnly);
          default:
            throw new Error(`No mapper defined for sub-app: ${app}`);
        }
      case mailSchema:
        return mapEmail(args as unknown as Email, workspaceId, orgId);
      case appSchema:
        return mapApp(args as Apps);
      case samTranscriptSchema:
        throw new Error(`${schemaName}: SAM transcripts must be queued with pre-transformed data. Pass the document via vespaQueue.addJob({ data: vespaDocument }).`);
      default:
        throw new Error(`Unknown schema: ${schemaName}`);
    }
  }

  if (jobType === 'update') {
    switch (schemaName) {
      case userSchema:
        // Full profile incl. workspaceId; weights are NOT set, so the partial update preserves them.
        return transformUserToVespa(args as User) as Partial<InsertDocument>;
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
export const fetchDataBySchema = async (
  schema: VespaSchema,
  docId: string,
  app?: SubApp
): Promise<Channel | Message | Project | Ticket | Email | RCAWithRelations | Canvas | Call | CollectionItem | Apps | User | null> => {
  switch (schema) {
    case userSchema:
      return await db.user.findUnique({
        where: { id: docId }
      });

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

    case callSchema:
      return await db.call.findUnique({
        where: { id: docId }
      });

    case fileSchema:
      if (!app) {
        throw new Error(`${schema}: fileSchema requires 'app' parameter to determine fetcher (CANVAS, TRANSCRIPT, RCA, or FILE)`);
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
        case SubApp.RCA: {
          const releaseRepository = new ReleaseRepository();
          return await releaseRepository.getRCAById(docId, { includeImpacts: true, includeCOEs: true }) as RCAWithRelations;
        }
        case SubApp.COLLECTIONS:
          return await db.collectionItem.findFirst({
            where: { fileId: docId, isLatest: true }
          });
        case SubApp.CHAT_ATTACHMENT:
        case SubApp.TICKET_ATTACHMENT:
          return await db.messageAttachment.findUnique({
            where: { id: docId }
          }) as any;
        default:
          throw new Error(`No fetcher defined for sub-app: ${app}`);
      }

    case mailSchema:
      return await db.email.findUnique({
        where: { id: docId },
      });

    case appSchema:
      return await db.apps.findUnique({
        where: { id: docId },
      });

    case samTranscriptSchema:
      throw new Error(`${schema}: SAM transcripts have no DB table. Pass pre-transformed data via vespaQueue.addJob({ data: vespaDocument }).`);

    default:
      throw new Error(`Unknown schema: ${schema}`);
  }
}

export const fetchAndMapBySchema = async (
  schema: VespaSchema,
  docId: string,
  jobType: VespaJobType,
  app?: SubApp,
  workspaceId?: string,
  orgId?: string,
  // When true, map file metadata only (skip content extraction). Only meaningful
  // for the `file` schema; ignored by other schemas.
  metadataOnly?: boolean,
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

  return await mapBySchema(schema, rawData, jobType, app, workspaceId, orgId, metadataOnly);
}


export const VespaOperationType: Record<VespaJobType, VespaOpType> = {
  feed: VespaOpType.INSERT,
  update: VespaOpType.UPDATE,
  delete: VespaOpType.DELETE,
}
