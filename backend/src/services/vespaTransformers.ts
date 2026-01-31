import { logger } from '@/utils/logger';
import {NAMESPACE} from '@/vespa/vespaConfig';
import {channelSchema, projectSchema} from '@/vespa/src/types';
import { chatContainerSchema } from '@xyne/vespa-ts/types';
import { convert } from 'html-to-text';

/**
 * Transformer functions to convert Prisma models to Vespa document format
 * Each transformer maps database fields to the corresponding Vespa schema fields
 */

// ============================================================================
// CHAT MESSAGE TRANSFORMER (chat_message)
// ============================================================================

export interface VespaChatMessageDocument {
  docId: string;
  docType: string;
  teamId: string;
  channelId: string;
  text: string;
  name: string;
  username: string;
  image: string;
  userId: string;
  createdAt: number;
  threadId: string;
  attachmentIds: string[];
  reactions: number;
  replyCount: number;
  replyUsersCount: number;
  mentions: string[];
  updatedAt: number;
  deletedAt: number;
  metadata: string;
}

export function transformMessageToVespa(
  message: any,
  orgName: string = 'default'
): VespaChatMessageDocument {
  logger.info(`[VESPA_TRANSFORMER] Transforming message to Vespa format: messageId=${message.messageId}, senderId=${message.senderId}, orgName=${orgName}`);
  
   const messageContent = convert(message.content || '', { wordwrap: false }) || '';
  // Support both old and new attachment formats
  const attachmentIds = message.attachments?.map((a: any) => a.id || a.attachmentId) || [];

  // Handle both Date objects and ISO string dates safely
  const createdAtTime = toTimestamp(message.createdAt);
  const updatedAtTime = toTimestamp(message.updatedAt, createdAtTime);
  
  const vespaDoc = {
    docId: message.messageId,
    docType: 'message',
    teamId: "", // To be asked
    channelId: message.channelId, // This maps messages to conversations in our schema
    text: messageContent,
    name: message.sender?.name || '',
    username: message.sender?.email || '',
    image: '', 
    userId: message.senderId,
    createdAt: createdAtTime,
    chatRef: `id:${NAMESPACE}:${channelSchema}::${message.channelId}`, // Use message.channelId from Zero mutators
    threadId: message.threadId,
    attachmentIds,
    reactions: Array.isArray(message.reactions) ? message.reactions.length : (message.reactions || 0),
    replyCount: message.replyCount || 0,
    replyUsersCount: message.replyUsersCount,
    mentions: message.mentions || [],
    updatedAt: updatedAtTime,
    deletedAt: toTimestamp(message.deletedAt),
    metadata: JSON.stringify(message.metadata || {}),
  };

  logger.debug(`[VESPA_TRANSFORMER] Message transformed:`, JSON.stringify(vespaDoc, null, 2));
  return vespaDoc;
}

// ============================================================================
// CHAT ATTACHMENT TRANSFORMER (chat_attachment)
// ============================================================================

export interface VespaChatAttachmentDocument {
  docId: string;
  docType: string;
  messageId: string;
  title: string;
  filename: string;
  mimeType: string;
  fileType: string;
  size: number;
  url: string;
  urlPrivate: string;
  urlPrivateDownload: string;
  thumbnailUrl: string;
  createdAt: number;
  teamId: string;
  userId: string;
  dimensions: string; // Changed to string to match tensor format
  duration: number;
  metadata: string;
  chunks: string[];
}

export function transformAttachmentToVespa(
  attachment: any,
  orgName: string = 'default'
): VespaChatAttachmentDocument {
  // Support both old and new attachment formats
  const attachmentId = attachment.id || attachment.attachmentId;
  const messageId = attachment.entityId || attachment.messageId;
  const filename = attachment.originalFilename || attachment.fileName;
  const mimeType = attachment.mimetype || attachment.mimeType;
  const fileSize = attachment.size || attachment.fileSize;
  const fileUrl = attachment.url || attachment.fileUrl;
  const userId = attachment.uploadedByUserId || attachment.uploadedBy;

  logger.info(`[VESPA_TRANSFORMER] Transforming attachment to Vespa format: attachmentId=${attachmentId}, messageId=${messageId}, orgName=${orgName}`);

  // Extract file type from mime type
  const fileType = getFileTypeFromMime(mimeType);

  // Extract dimensions from metadata if available
  const metadata = (attachment.metadata as any) || {};
  const dimensionsStr = metadata.width && metadata.height
    ? `[${metadata.width}, ${metadata.height}]`
    : '[0, 0]';

  // Generate chunks for text-based files (PDFs, docs, etc.)
  const chunks = generateFileChunks(filename, metadata);

  // Handle both Date objects and ISO string dates safely
  const createdAtTime = toTimestamp(attachment.createdAt);

  const vespaDoc = {
    docId: attachmentId,
    docType: 'attachment',
    messageId: messageId,
    title: filename,
    filename: filename,
    mimeType: mimeType,
    fileType,
    size: fileSize,
    url: fileUrl,
    urlPrivate: fileUrl,
    urlPrivateDownload: fileUrl,
    thumbnailUrl: attachment.thumbnailUrl || '',
    createdAt: createdAtTime,
    teamId: "",
    userId: userId,
    dimensions: dimensionsStr,
    duration: metadata.duration || 0,
    metadata: JSON.stringify(metadata),
    chunks,
  };

  logger.debug(`[VESPA_TRANSFORMER] Attachment transformed:`, JSON.stringify(vespaDoc, null, 2));
    return vespaDoc;
}

// ============================================================================
// CHAT CONTAINER TRANSFORMER (chat_container)
// ============================================================================

export interface VespaChatContainerDocument {
  docId: string;
  docType: string;
  name: string;
  channelName: string;
  teamId: string;
  creator: string;
  scopeType: string;
  visibility: string;
  isIm: boolean;
  isMpim: boolean;
  permissions: string[];
  isPrivate: boolean;
  createdBy: string;
  ownerId: string;
  projectId: string;
  metadata: string;
  lastActivityAt: number;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
  topic: string;
  description: string;
  isArchived: boolean;
  isGeneral: boolean;
  memberCount: number;
}

export function transformChannelToVespa(
  channel: any,
  orgName?: string
): VespaChatContainerDocument {
  // Support both old and new channel formats


  logger.info(`[VESPA_TRANSFORMER] Transforming channel to Vespa format: channelId=${channel.id}, name=${channel.name}, scopeType=${channel.scopeType}, orgName=${orgName}`);
  logger.info(`[VESPA_TRANSFORMER] Channel input data:`, JSON.stringify(channel, null, 2));

  const metadata = (channel.metadata as any) || {};

  // Handle date conversions safely
  const lastActivityAtTime = toTimestamp(channel.lastActivityAt);
  const createdAtTime = toTimestamp(channel.createdAt);
  const updatedAtTime = toTimestamp(channel.updatedAt);

  // Determine the owner ID
  // If channel.createdBy is an email (contains @), it should have been preserved from the original user ID
  // Otherwise, channel.createdBy is already the user ID
  let ownerId = channel.createdBy;
  if (!ownerId && channel.creator && channel.creator.includes('@')) {
    // If we don't have createdBy but have creator email, we need to extract the user ID from somewhere else
    // This is a fallback scenario, ideally we should always have the user ID
    logger.warn(`[VESPA_TRANSFORMER] Missing ownerId for channel ${channel.id}, channelId might be unreliable`);
  }

  const vespaDoc = {
    docId: channel.id,
    docType: 'channel',
    name: channel.name,
    channelName: channel.name,
    teamId: "",
    creator: channel.creator, // Should be email
    scopeType: channel.scopeType,
    visibility: channel.visibility,
    isIm: channel.scopeType === 'DM',
    isMpim: channel.scopeType === 'GROUP_DM',
    permissions: channel.permissions || [], // group of user ids in this channel
    isPrivate: channel.visibility === 'PRIVATE',
    createdBy: channel.creator, // Should be email (same as creator)
    ownerId: channel.createdBy, // Should be user ID
    projectId: channel.projectId,
    metadata: JSON.stringify(metadata),
    lastActivityAt: lastActivityAtTime,
    createdAt: createdAtTime,
    updatedAt: updatedAtTime,
    lastSyncedAt: Date.now(),
    topic: '',
    description: channel.description || '',
    isArchived:  false,
    isGeneral:  false,
    memberCount: channel.memberCount || 0,
  };

  logger.info(`[VESPA_TRANSFORMER] Channel transformed:`, JSON.stringify(vespaDoc, null, 2));
  return vespaDoc;
}

// ============================================================================
// PROJECT TRANSFORMER (project)
// ============================================================================

export interface VespaProjectDocument {
  docId: string;
  name: string;
  description: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
  stages: string;
  docType: string;
}

export function transformProjectToVespa(
  project: any
): VespaProjectDocument {
  logger.info(`[VESPA_TRANSFORMER] Transforming project to Vespa format: projectId=${project.id}, name=${project.name}`);

  // Handle both Date objects and ISO string dates safely
  const createdAtTime = toTimestamp(project.createdAt);
  const updatedAtTime = toTimestamp(project.updatedAt, createdAtTime);


  const vespaDoc = {
    docId: project.id,
    name: project.name,
    description: project.description || '',
    createdBy: project.createdBy,
    updatedBy: project.updatedBy,
    createdAt: createdAtTime,
    updatedAt: updatedAtTime,
    stages: "", // stages is now already an array of stage names
    docType: 'project',
  };

  logger.debug(`[VESPA_TRANSFORMER] Project transformed:`, JSON.stringify(vespaDoc, null, 2));
  return vespaDoc;
}

// ============================================================================
// TICKET TRANSFORMER (ticket)
// ============================================================================

export interface VespaTicketDocument {
  docId: string;
  docType: string;
  convId: string;
  userGroupId: string;
  channelRef: string; // Reference to chat_container
  projectRef: string; // Reference to project
  threadId: string;
  status: string;
  ownerEmail: string;
  assignedTo: string;
  title: string;
  workflowType: string;
  description: string;
  createdBy: string;
  updatedAt: number;
  createdAt: number;
  closedBy: string;
  closedAt: number;
  parentTicketId: string;
  ticketType: string;
  priority: string;
  stage: string;
  attachmentIds: string[];
  metadata: string;
  deletedAt: number;
}

export function transformTicketToVespa(
  ticket: any
): VespaTicketDocument {
  logger.info(`[VESPA_TRANSFORMER] Transforming ticket to Vespa format: ticketId=${ticket.id}, title=${ticket.title}, status=${ticket.statusV2}`);

  const vespaDoc = {
    docId: ticket.id,
    docType: 'ticket',
    convId: ticket.conversationId || '',
    userGroupId: ticket.userGroupId || '',
    channelRef: `id:${NAMESPACE}:${chatContainerSchema}::${ticket.channelId}`,
    projectRef:  `id:${NAMESPACE}:${projectSchema}::${ticket.projectId}`,
    threadId: ticket.conversationId || '',
    status: ticket.statusV2.toLowerCase(),
    ownerEmail: ticket.ownerEmail || ticket.createdBy, // Use ownerEmail populated from repository, fallback to createdBy
    assignedTo: ticket.assignedTo,
    title: ticket.title,
    workflowType: ticket.workflowType,
    description: ticket.description || '',
    createdBy: ticket.createdBy,
    updatedAt: toTimestamp(ticket.updatedAt),
    createdAt: toTimestamp(ticket.createdAt),
    closedBy: ticket.closedBy,
    closedAt: toTimestamp(ticket.closedAt),
    parentTicketId: ticket.parentTicketId,
    ticketType: ticket.parentTicketId ? 'SUB-TICKET' : 'TICKET',
    priority: ticket.priority,
    stage: ticket.stageName,
    attachmentIds: ticket.attachmentIds || [],
    metadata: JSON.stringify(ticket.metadata || {}),
    deletedAt: toTimestamp(ticket.deletedAt),
  };

  logger.debug(`[VESPA_TRANSFORMER] Ticket transformed:`, JSON.stringify(vespaDoc, null, 2));
  return vespaDoc;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Safely converts a date string, Date object, or null/undefined to a timestamp.
 * @param date - The date to convert (Date object, ISO string, undefined, or null)
 * @param defaultValue - Default value to return if date is invalid (default: 0)
 * @returns Unix timestamp in milliseconds
 */
function toTimestamp(date: Date | string | undefined | null, defaultValue: number = 0): number {
  if (!date) return defaultValue;
  const d = date instanceof Date ? date : new Date(date);
  // Check for Invalid Date
  if (isNaN(d.getTime())) {
    return defaultValue;
  }
  return d.getTime();
}

function getFileTypeFromMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf')) return 'document';
  if (mimeType.includes('document') || mimeType.includes('word')) return 'document';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'spreadsheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
  return 'other';
}

function generateFileChunks(fileName: string, metadata: any): string[] {
  // For now, just return filename as a chunk
  // In the future, you can extract text content from files
  const chunks = [fileName];

  // Add any text content from metadata
  if (metadata.description) {
    chunks.push(metadata.description);
  }

  return chunks;
}

// ============================================================================
// USER TRANSFORMER (user)
// ============================================================================

export interface VespaUserDocument {
  docId: string;
  docType: string;
  name: string;
  email: string;
  status: string;
  userGroupIds: string[];
  photoLink: string;
  language: string;
  orgName: string;
  orgLocation: string;
  orgDescription: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoggedIn: number;
  owner: string;
}

export function transformUserToVespa(
  user: any,
  orgName: string = 'default'
): VespaUserDocument {
  logger.info(`[VESPA_TRANSFORMER] Transforming user to Vespa format: userId=${user.id}, email=${user.email}`);

  // Handle both Date objects and ISO string dates safely
  const createdAtTime = toTimestamp(user.createdAt);
  const lastLoggedInTime = toTimestamp(user.lastLoggedIn);

  const vespaDoc = {
    docId: user.id,
    docType: 'user',
    name: user.name || '',
    email: user.email || '',
    status: user.status || 'ACTIVE',
    userGroupIds: user.userGroupIds || [],
    photoLink: user.photoLink || user.image || '',
    language: user.language || 'en',
    orgName: orgName,
    orgLocation: user.orgLocation || '',
    orgDescription: user.orgDescription || '',
    isAdmin: user.isAdmin || false,
    createdAt: createdAtTime,
    lastLoggedIn: lastLoggedInTime,
    owner: user.owner || user.email || '',
  };

  logger.debug(`[VESPA_TRANSFORMER] User transformed:`, JSON.stringify(vespaDoc, null, 2));
  return vespaDoc;
}

