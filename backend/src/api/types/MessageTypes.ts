// Message API Response Types
// These types define the structure of API responses from the message endpoints

// User info interface for messages
export interface ApiMessageUser {
  id: string;
  name: string;
  email: string;
}

// Message attachment structure
export interface ApiMessageAttachment {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  thumbnailUrl?: string | null;
  uploadedBy: string;
  messageId: string;
  conversationId: string;
  createdAt: Date;
  metadata: any;
}

// Base message structure for API responses
export interface ApiMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  msgType: string;
  hasAttachment?: boolean;
  edited?: boolean;
  visibleTo?: string | null; // null = public, userId = visible only to that user
  attachments?: ApiMessageAttachment[];
  createdAt: Date;
  updatedAt?: Date;
  sender: ApiMessageUser;
}

// Pagination metadata
export interface ApiPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// API Response Types for each endpoint

// POST /conversations/:conversationId/messages
export interface SendMessageResponse {
  messageId: string;
  conversationId: string;
  content: string;
  msgType: string;
  hasAttachment?: boolean;
  edited?: boolean;
  visibleTo?: string | null;
  attachments?: ApiMessageAttachment[];
  createdAt: Date;
  sender: ApiMessageUser;
}

// GET /conversations/:conversationId/messages
export interface GetMessagesResponse {
  messages: ApiMessage[];
  pagination?: ApiPagination;
  total?: number;
}

// GET /messages/:messageId
export interface GetMessageResponse {
  messageId: string;
  conversationId: string;
  content: string;
  msgType: string;
  hasAttachment?: boolean;
  edited?: boolean;
  visibleTo?: string | null;
  attachments?: ApiMessageAttachment[];
  createdAt: Date;
  updatedAt?: Date;
  sender: ApiMessageUser;
}

// PUT /messages/:messageId
export interface UpdateMessageResponse {
  messageId: string;
  content: string;
  edited?: boolean;
  visibleTo?: string | null;
  updatedAt: Date;
  sender: ApiMessageUser;
}

// DELETE /messages/:messageId
export interface DeleteMessageResponse {
  message: string;
  messageId: string;
}

// GET /conversations/:conversationId/messages/search
export interface SearchMessagesResponse {
  query: string;
  messages: ApiMessage[];
  total: number;
}
