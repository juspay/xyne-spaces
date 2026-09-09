import { logger, Event as LogEvent } from '../../utils/logger';
import { apiInstance } from '../clients/apiClient';
import { AxiosError } from 'axios';
import { getFilesDimensions } from '../../components/ui/utils/files';

// ============================================================================
// TYPES
// ============================================================================

export interface MessageSender {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface MessageAttachment {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  thumbnailUrl?: string;
  uploadedBy: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface InitialMessage {
  messageId: string;
  content: string;
  msgType: string;
  hasAttachment?: boolean;
  attachments?: MessageAttachment[];
  createdAt: string;
  sender: MessageSender;
}

export interface CreateConversationRequest {
  content: string;
  msgType?: 'USER' | 'BOT';
  files?: File[];
  videoThumbnails?: Map<File, Blob>;
}

export interface CreateConversationResponse {
  conversationId: string;
  channelId: string;
  createdBy: string;
  initialMessage: InitialMessage;
  replyCount: number;
  pinned: boolean;
  createdAt: string;
}

export interface SendMessageRequest {
  content: string;
  msgType?: 'USER' | 'BOT';
  files?: File[];
  showInChannel?: boolean;
  videoThumbnails?: Map<File, Blob>;
}

export interface ReplyToConversationResponse {
  messageId: string;
  conversationId: string;
  content: string;
  msgType: string;
  hasAttachment?: boolean;
  attachments?: MessageAttachment[];
  createdAt: string;
  sender: MessageSender;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  message?: string;
}

export interface MarkTicketSuggestionAsCreatedRequest {
  suggestionId: string;
  ticketId: string;
  xyneId: string;
  title: string;
  ticketConversationId: string;
}

export interface MarkTicketSuggestionAsCreatedResponse {
  success: boolean;
  messageId: string;
  conversationId: string;
}

export type ThreadListSection = 'unread' | 'read' | 'recent';

// Threads inbox sort mode.
// - 'sections' (default): unread threads first, then read threads.
// - 'recent': flat list ordered by lastReplyAt desc, no read/unread divider,
//   without marking threads as read.
export type ThreadListSort = 'sections' | 'recent';

export interface ThreadListEntry {
  conversationId: string;
  channelId: string;
  sectionAtLoad: ThreadListSection;
}

export interface ThreadListResponse {
  threads: ThreadListEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ============================================================================
// CUSTOM ERROR CLASS
// ============================================================================

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as ApiErrorResponse).error === 'string'
  );
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class ConversationService {
  async getUserThreads(
    cursor: string | null,
    limit: number,
    signal?: AbortSignal,
    sort: ThreadListSort = 'sections',
  ): Promise<ThreadListResponse> {
    const response = await apiInstance.get<ThreadListResponse>('/conversations/threads', {
      params: {
        limit,
        ...(cursor ? { cursor } : {}),
        ...(sort !== 'sections' ? { sort } : {}),
      },
      ...(signal ? { signal } : {}),
    });

    return response.data;
  }

  /**
   * Create a new conversation with optional file attachments
   * Uses multipart/form-data for file uploads
   */
  async createConversation(
    channelId: string,
    data: CreateConversationRequest,
  ): Promise<CreateConversationResponse> {
    try {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('📤 [FRONTEND-ATTACHMENT] Starting conversation creation with files:'),
        context: [
          {
            channelId,
            hasContent: !!data.content,
            contentLength: data.content?.length || 0,
            filesCount: data.files?.length || 0,
            thumbnailsCount: data.videoThumbnails?.size || 0,
            msgType: data.msgType,
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const formData = new FormData();

      // Add text fields
      if (data.content) {
        formData.append('content', data.content);
      }
      if (data.msgType) {
        formData.append('msgType', data.msgType);
      }

      // Add files if present
      if (data.files && data.files.length > 0) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('📎 [FRONTEND-ATTACHMENT] Processing files for upload:'),
          context: [
            data.files.map((file, index) => ({
              index,
              name: file.name,
              size: file.size,
              type: file.type,
              hasThumbnail: data.videoThumbnails?.has(file) || false,
            })),
          ],
        });

        // Extract dimensions for all files (images/videos only)
        const dimensionsMap = await getFilesDimensions(data.files);

        // Build file metadata mapping
        const fileMetadata: Array<{
          fileIndex: number;
          hasThumbnail: boolean;
          thumbnailIndex?: number;
          width?: number;
          height?: number;
          duration?: number;
        }> = [];

        let thumbnailIndex = 0;

        data.files.forEach((file: File, fileIndex: number) => {
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String(`📤 [FRONTEND-ATTACHMENT] Adding file ${fileIndex} to form data:`),
            context: [
              {
                name: file.name,
                size: file.size,
                type: file.type,
              },
            ],
          });
          formData.append('files', file);

          // Get dimensions for this file (null for non-media files)
          const dimensions = dimensionsMap.get(file);

          // Check if this file has a thumbnail
          const thumbnail = data.videoThumbnails?.get(file);
          if (thumbnail) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String(`🖼️ [FRONTEND-ATTACHMENT] Adding thumbnail for file ${fileIndex}:`),
              context: [
                {
                  thumbnailSize: thumbnail.size,
                  thumbnailType: thumbnail.type,
                },
              ],
            });
            // Add thumbnail to form data
            formData.append('thumbnails', thumbnail, `thumb_${thumbnailIndex}.jpg`);

            // Record the mapping with dimensions
            fileMetadata.push({
              fileIndex,
              hasThumbnail: true,
              thumbnailIndex,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
              ...(dimensions?.duration && { duration: dimensions.duration }),
            });

            thumbnailIndex++;
          } else {
            // No thumbnail for this file
            fileMetadata.push({
              fileIndex,
              hasThumbnail: false,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
              ...(dimensions?.duration && { duration: dimensions.duration }),
            });
          }
        });

        // Add metadata as JSON
        const fileMetadataJson = JSON.stringify(fileMetadata);
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('📋 [FRONTEND-ATTACHMENT] File metadata prepared:'),
          context: [fileMetadata],
        });
        formData.append('fileMetadata', fileMetadataJson);
      }

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('🚀 [FRONTEND-ATTACHMENT] Sending API request to create conversation:'),
        context: [
          {
            endpoint: `/channels/${channelId}/conversations`,
            formDataKeys: Array.from(formData.keys()),
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const response = await apiInstance.post<CreateConversationResponse>(
        `/channels/${channelId}/conversations`,
        formData,
      );

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('✅ [FRONTEND-ATTACHMENT] Conversation created successfully:'),
        context: [
          {
            conversationId: response.data.conversationId,
            messageId: response.data.initialMessage.messageId,
            hasAttachments: (response.data.initialMessage.attachments?.length ?? 0) > 0,
            attachmentsCount: response.data.initialMessage.attachments?.length ?? 0,
            timestamp: new Date().toISOString(),
          },
        ],
      });

      return response.data;
    } catch (error) {
      // Handle Axios errors with proper typing
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;

        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  /**
   * Reply to an existing conversation with optional file attachments
   * Uses multipart/form-data for file uploads
   */
  async replyToConversation(
    conversationId: string,
    data: SendMessageRequest,
  ): Promise<ReplyToConversationResponse> {
    try {
      const formData = new FormData();

      // Add text fields
      if (data.content) {
        formData.append('content', data.content);
      }
      if (data.msgType) {
        formData.append('msgType', data.msgType);
      }
      if (data.showInChannel) {
        formData.append('showInChannel', 'true');
      }

      // Add files if present
      if (data.files && data.files.length > 0) {
        // Extract dimensions for all files (images/videos only)
        const dimensionsMap = await getFilesDimensions(data.files);

        // Build file metadata mapping
        const fileMetadata: Array<{
          fileIndex: number;
          hasThumbnail: boolean;
          thumbnailIndex?: number;
          width?: number;
          height?: number;
          duration?: number;
        }> = [];

        let thumbnailIndex = 0;

        data.files.forEach((file: File, fileIndex: number) => {
          formData.append('files', file);

          // Get dimensions for this file (null for non-media files)
          const dimensions = dimensionsMap.get(file);

          // Check if this file has a thumbnail
          const thumbnail = data.videoThumbnails?.get(file);
          if (thumbnail) {
            // Add thumbnail to form data
            formData.append('thumbnails', thumbnail, `thumb_${thumbnailIndex}.jpg`);

            // Record the mapping with dimensions
            fileMetadata.push({
              fileIndex,
              hasThumbnail: true,
              thumbnailIndex,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
              ...(dimensions?.duration && { duration: dimensions.duration }),
            });

            thumbnailIndex++;
          } else {
            // No thumbnail for this file
            fileMetadata.push({
              fileIndex,
              hasThumbnail: false,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
              ...(dimensions?.duration && { duration: dimensions.duration }),
            });
          }
        });

        // Add metadata as JSON
        const fileMetadataJson = JSON.stringify(fileMetadata);
        formData.append('fileMetadata', fileMetadataJson);
      }

      const response = await apiInstance.post<ReplyToConversationResponse>(
        `/conversations/${conversationId}/messages`,
        formData,
      );

      return response.data;
    } catch (error) {
      // Handle Axios errors with proper typing
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;

        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  /**
   * Mark a ticket suggestion as created in the message content
   * Updates the YAML frontmatter to move suggestion to created array
   */
  async markTicketSuggestionAsCreated(
    conversationId: string,
    messageId: string,
    data: MarkTicketSuggestionAsCreatedRequest,
  ): Promise<MarkTicketSuggestionAsCreatedResponse> {
    try {
      const response = await apiInstance.put<MarkTicketSuggestionAsCreatedResponse>(
        `/conversations/${conversationId}/messages/${messageId}/ticket-suggestion`,
        data,
      );

      return response.data;
    } catch (error) {
      // Handle Axios errors with proper typing
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;

        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }

      // Re-throw unknown errors
      throw error;
    }
  }
  /**
   * Mark a Pulse actionable item as sent.
   * Updates the YAML frontmatter to move the item from pulseItems → pulseSent.
   */
  async markPulseItemAsSent(
    conversationId: string,
    messageId: string,
    itemId: string,
  ): Promise<{ success: boolean; messageId: string; conversationId: string }> {
    try {
      const response = await apiInstance.put<{
        success: boolean;
        messageId: string;
        conversationId: string;
      }>(`/conversations/${conversationId}/messages/${messageId}/pulse-item`, { itemId });
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;
        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }
      throw error;
    }
  }

  async dispatchAppAction(data: {
    actionId: string;
    actionableUrl: string;
    context: Record<string, unknown>;
    messageId: string;
    conversationId: string;
  }): Promise<void> {
    try {
      await apiInstance.post('/apps/chat/action', data);
    } catch (error) {
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;
        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }
      throw error;
    }
  }

  /**
   * Update a Pulse merchant entry in the message frontmatter.
   * Used when the user corrects the auto-detected merchant name.
   */
  async updatePulseMerchant(
    conversationId: string,
    messageId: string,
    data: { merchantId: string; orgId: string; orgName: string },
  ): Promise<{ success: boolean; messageId: string; conversationId: string }> {
    try {
      const response = await apiInstance.put<{
        success: boolean;
        messageId: string;
        conversationId: string;
      }>(`/conversations/${conversationId}/messages/${messageId}/pulse-merchant`, data);
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;
        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }
      throw error;
    }
  }
}

export const conversationService = new ConversationService();
