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
