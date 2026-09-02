import type { TicketCustomFormData } from '@/database/repositories/formsRepository';

/**
 * Enum for chat event types
 */
export enum ChatEventType {
    MESSAGE_POSTED = 'MESSAGE_POSTED',
    MESSAGE_UPDATED = 'MESSAGE_UPDATED',
}

/**
 * Enum for file upload event types
 */
export enum FileUploadEventType {
    FILE_UPLOADED = 'FILE_UPLOADED',
}

/**
 * Enum for ticket event types
 */
export enum TicketEventType {
    TICKET_CREATED = 'TICKET_CREATED',
}

/**
 * Enum for app event types
 */
export enum AppEventType {
    APP_MENTION = 'APP_MENTIONED',
    DM = 'DIRECT_MESSAGE',
    USER_MENTIONED = 'USER_MENTIONED',
    EMAIL = 'EMAIL',
    ADDITIONAL_FORM_FIELD_UPDATED = 'ADDITIONAL_FORM_FIELD_UPDATED',
    DESK_REPLY = 'DESK_REPLY',
}

export enum ContentFormat {
    MARKDOWN = 'markdown',
}

/**
 * Attachment interface for app events
 */
export interface AppEventAttachment {
    attachmentId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileUrl: string;
}

/**
 * Payload type for APP_MENTION events
 */
export interface AppMentionEventPayload {
    /** Additive trusted routing context for headless recipients such as Claw. */
    workspaceId?: string;
    orgId?: string;
    orgMemberId?: string;
    conversationId: string;
    messageId: string;
    content: string;
    cleanContent: string;
    createdAt: Date | number;
    userId: string;
    senderName?: string;
    channelId: string;
    channelName?: string;
    attachments?: AppEventAttachment[];
    /** Files referenced (tagged) from the thread, resolved and authorized server-side. */
    referencedAttachments?: AppEventAttachment[];
    metadata?: Record<string, unknown>;
}

/**
 * Payload type for DM events
 */
export interface DMEventPayload {
    workspaceId?: string;
    orgId?: string;
    orgMemberId?: string;
    conversationId: string;
    messageId: string;
    content: string;
    cleanContent: string;
    createdAt: Date | number;
    userId: string;
    senderName?: string;
    channelId: string;
    channelName?: string;
    attachments?: AppEventAttachment[];
    /** Files referenced (tagged) from the thread, resolved and authorized server-side. */
    referencedAttachments?: AppEventAttachment[];
    metadata?: Record<string, unknown>;
}

/**
 * Payload type for USER_MENTIONED events — fired when any user is mentioned
 * in a channel where an app is a participant.
 */
export interface UserMentionedEventPayload {
    workspaceId?: string;
    orgId?: string;
    orgMemberId?: string;
    conversationId: string;
    messageId: string;
    content: string;
    cleanContent: string;
    createdAt: Date | number;
    userId: string;
    senderName?: string;
    channelId: string;
    channelName?: string;
    mentionedUserIds: string[];
    metadata?: Record<string, unknown>;
}

/**
 * Payload type for EMAIL events
 */
export interface EmailEventPayload {
    workspaceId?: string;
    orgId?: string;
    conversationId: string;
    subject: string;
    content: string;
    to : string[];
    from : string;
    recipients: string[];
    parentId: string;
    id : string;
    ticketId: string;
    channelName: string;
}

/**
 * Payload type for ADDITIONAL_FORM_FIELD_UPDATED events
 * Fired when any additional form field on a ticket is updated.
 * Apps can filter by fieldName to handle specific fields (e.g., "Merchant ID").
 */
export interface AdditionalFormFieldUpdatedPayload {
    ticketId: string;
    conversationId: string;
    channelId: string;
    boardId: string;
    boardName: string;
    fieldName: string;
    fieldValue: string;
    previousValue?: string;
    updatedBy: string;
    workspaceId: string;
    orgId?: string;
}

export interface DeskReplyAttachment {
    name: string;
    url: string;
    mimeType: string;
    size?: number;
}

export interface DeskReplyEventPayload {
    channelId: string;
    conversationId: string;
    ticketId?: string;
    threadId: string;
    externalId: string;
    body: string;
    attachments?: DeskReplyAttachment[];
    replierUserId: string;
    replierName?: string;
    workspaceId?: string;
}

/**
 * Base app event type with dynamic, event-specific payload
 */
export interface BaseAppEvent {
    eventType: AppEventType;
    payload: AppMentionEventPayload | DMEventPayload | UserMentionedEventPayload | EmailEventPayload | AdditionalFormFieldUpdatedPayload | DeskReplyEventPayload;
    timestamp: string; // ISO timestamp
}

/**
 * Response type for chat action API endpoints (postMessage, updateMessage)
 */
export interface ChatActionResponse {
    eventType: ChatEventType;
    conversationId: string;
    messageId: string;
    channelId?: string;
    ticketId?: string;
}

/**
 * Response type for file upload API endpoints (uploadFiles)
 */
interface FileAttachment {
    fileid: string;
    originalFilename: string;
    url: string;
    size: number;
    mimeType: string;
}
export interface FileUploadResponse {
    eventType: FileUploadEventType;
    conversationId: string;
    messageId: string;
    attachments: Array<FileAttachment>;
}

/**
 * Response type for ticket action API endpoints (createTicket)
 */
export interface TicketActionResponse {
    eventType: TicketEventType;
    ticketId: string;
    xyneId: string;
    conversationId: string;
    messageId: string;
}

export interface PaginatedResponse<T> {
    items: T[];
    nextCursor?: string; 
    hasMore: boolean;
}


export interface PaginationRequest {
    limit?: number; 
    cursor?: string; 
}

/**
 * Channel history item - represents a message in a channel
 */
export interface ChannelHistoryItem {
    initialMessageId: string;
    conversationId: string;
    content: string;
    cleanContent: string;
    userId: string;
    createdAt: Date;
    ticketId?: string;
    attachments?: AppEventAttachment[];
}

/**
 * Cursor for channel history pagination
 */
export interface ChannelHistoryCursor {
    conversationId: string;
    createdAt: number; // timestamp
}

/**
 * Request type for channel history API endpoint
 */
export interface ChannelHistoryRequest extends PaginationRequest {
    channelId: string;
}

/**
 * Response type for channel history API endpoint
 */
export interface ChannelHistoryResponse extends PaginatedResponse<ChannelHistoryItem> {
    channelId: string;
}

/**
 * Conversation reply item - represents a message in a conversation
 */
export interface ConversationRepliesItem {
    messageId: string;
    conversationId: string;
    parentMessageId: string;
    content: string;
    cleanContent: string;
    userId: string;
    createdAt: Date;
    ticketId?: string;
    attachments?: AppEventAttachment[];
}

/**
 * Cursor for conversation replies pagination
 */
export interface ConversationRepliesCursor {
    messageId: string;
    createdAt: number;
}

export interface ChannelsResponse {
    id: string;
    name: string;
    description?: string;
    type: string;
    scopeType: string;
    visibility: string;
    projectId: string;
    createdBy: string;
    createdAt: Date;
    participantCount: number;
}

/**
 * Channel list item - represents a channel in the list API
 */
export interface ChannelListItem {
    id: string;
    name: string;
    description?: string;
    scopeType: string;
    visibility?: string;
    projectId: string;
    createdBy: string;
    createdAt: Date;
}

/**
 * Response type for channel list API endpoint
 */
export interface ChannelListResponse extends PaginatedResponse<ChannelListItem> {}

/**
 * Request type for conversation replies API endpoint
 */
export interface ConversationRepliesRequest extends PaginationRequest {
    channelId: string;
    conversationId: string;
}

/**
 * Response type for conversation replies API endpoint
 */
export interface ConversationRepliesResponse extends PaginatedResponse<ConversationRepliesItem> {
    channelId: string;
}

/**
 * Email reply item — one email in a thread
 */
export interface EmailRepliesItem {
    id: string;
    parentId: string;
    type: string;
    subject: string;
    content: string;
    to: string[];
    from: string;
    cc: string[];
    bcc: string[];
    createdAt: Date;
}

/**
 * Cursor for email replies pagination
 */
export interface EmailRepliesCursor {
    id: string;
    createdAt: number;
}

/**
 * Request type for email replies API endpoint
 */
export interface EmailRepliesRequest extends PaginationRequest {
    channelId?: string;
    channelName?: string;
    conversationId: string;
}

/**
 * Response type for email replies API endpoint
 */
export interface EmailRepliesResponse extends PaginatedResponse<EmailRepliesItem> {}

/** Ticket row returned by list-by-merchant-sender apps API */
export interface MerchantTicketListItem {
  ticketId: string;
  xyneId: string;
  title: string;
  statusV2: string;
  stageName: string;
  priority: string;
  createdAt: Date;
  lastEmailAt: Date;
  conversationId: string;
  channelId: string;
  boardId?: string | null;
  projectId?: string;
  senderEmail?: string;
  senderName?: string;
  customFormData?: TicketCustomFormData | null;
}

export interface MerchantTicketsListResponse extends PaginatedResponse<MerchantTicketListItem> {}

/**
 * User data response for user API endpoint
 */
export interface UserResponse {
    userId: string;
    name: string;
    email: string;
    picture: string | null;
    userType: string;
    status: string;
    joined: Date;
    statusEmoji: string | null;
    statusContent: string | null;
    statusExpiryAt: Date | null;
}

/**
 * User group data response for user groups API endpoint
 */
export interface UserGroupResponse {
    id: string;
    name: string;
    alias: string | null;
    description: string | null;
    isActive: boolean;
    memberCount: number;
    createdAt: Date;
    updatedAt: Date;
}
