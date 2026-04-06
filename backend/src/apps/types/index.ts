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
    metadata?: Record<string, unknown>;
}

/**
 * Payload type for DM events
 */
export interface DMEventPayload {
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
    metadata?: Record<string, unknown>;
}

/**
 * Payload type for USER_MENTIONED events — fired when any user is mentioned
 * in a channel where an app is a participant.
 */
export interface UserMentionedEventPayload {
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
 * Base app event type with dynamic, event-specific payload
 */
export interface BaseAppEvent {
    eventType: AppEventType;
    payload: AppMentionEventPayload | DMEventPayload | UserMentionedEventPayload;
    timestamp: string; // ISO timestamp
}

/**
 * Response type for chat action API endpoints (postMessage, updateMessage)
 */
export interface ChatActionResponse {
    eventType: ChatEventType;
    conversationId: string;
    messageId: string;    
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
 * Channel history item - represents a conversation with its initial message
 */
export interface ChannelHistoryItem {
    initialMessageId: string;
    conversationId: string;
    content: string;
    cleanContent: string;
    userId: string;
    createdAt: Date;
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
export interface ChannelHistoryResponse extends PaginatedResponse<ChannelHistoryItem> {}

/**
 * Conversation reply item - represents a message in a conversation
 */
export interface ConversationRepliesItem {
    messageId: string;
    conversationId: string;
    content: string;
    cleanContent: string;
    userId: string;
    createdAt: Date;
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
 * Request type for conversation replies API endpoint
 */
export interface ConversationRepliesRequest extends PaginationRequest {
    channelId: string;
    conversationId: string;
}

/**
 * Response type for conversation replies API endpoint
 */
export interface ConversationRepliesResponse extends PaginatedResponse<ConversationRepliesItem> {}

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
}
