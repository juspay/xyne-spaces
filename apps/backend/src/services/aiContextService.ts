/**
 * AI Context Service
 *
 * Provides utility functions for retrieving context from various data sources
 * (Message, Conversation, Ticket, Call, Canvas) for AI/LLM consumption.
 *
 * These functions are designed to be schema-agnostic where possible,
 * allowing callers to specify the schema name and filter parameters.
 */

import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  convertToBase64,
  convertManyToBase64,
  convertMediaToBase64,
  Base64AttachmentResult,
  Base64ConversionOptions,
  getMediaCategory,
} from '@/utils/attachmentBase64';
import {
  Message,
  Conversation,
  Ticket,
  Call,
  Canvas,
  MessageAttachment,
  Prisma,
} from '@prisma/client';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Supported schema names for context retrieval
 */
export type ContextSchemaName = 'Message' | 'Conversation' | 'Ticket' | 'Call' | 'Canvas' | 'MessageAttachment';

/**
 * Time range filter options
 */
export interface TimeRangeFilter {
  /** Start of time range (inclusive) */
  start?: Date;
  /** End of time range (inclusive) */
  end?: Date;
}

/**
 * Valid date field names for each schema (derived from Prisma types)
 */
export type MessageDateField = {
  [K in keyof Message]: Message[K] extends Date | null ? K : never;
}[keyof Message];

export type ConversationDateField = {
  [K in keyof Conversation]: Conversation[K] extends Date | null ? K : never;
}[keyof Conversation];

export type TicketDateField = {
  [K in keyof Ticket]: Ticket[K] extends Date | null ? K : never;
}[keyof Ticket];

export type CallDateField = {
  [K in keyof Call]: Call[K] extends Date | null ? K : never;
}[keyof Call];

export type CanvasDateField = {
  [K in keyof Canvas]: Canvas[K] extends Date | null ? K : never;
}[keyof Canvas];

export type MessageAttachmentDateField = {
  [K in keyof MessageAttachment]: MessageAttachment[K] extends Date | null ? K : never;
}[keyof MessageAttachment];

/**
 * Union of all valid date field names across schemas
 */
export type DateFieldName = MessageDateField | ConversationDateField | TicketDateField | CallDateField | CanvasDateField | MessageAttachmentDateField;

/**
 * Valid user field names for each schema (derived from Prisma types)
 * Extracts all string fields that could represent user IDs
 */
export type MessageUserField = {
  [K in keyof Message]: Message[K] extends string | null ? K : never;
}[keyof Message];

export type ConversationUserField = {
  [K in keyof Conversation]: Conversation[K] extends string | null ? K : never;
}[keyof Conversation];

export type TicketUserField = {
  [K in keyof Ticket]: Ticket[K] extends string | null ? K : never;
}[keyof Ticket];

export type CallUserField = {
  [K in keyof Call]: Call[K] extends string | null ? K : never;
}[keyof Call];

export type CanvasUserField = {
  [K in keyof Canvas]: Canvas[K] extends string | null ? K : never;
}[keyof Canvas];

export type MessageAttachmentUserField = {
  [K in keyof MessageAttachment]: MessageAttachment[K] extends string | null ? K : never;
}[keyof MessageAttachment];

/**
 * Union of all valid user field names across schemas
 */
export type UserFieldName = MessageUserField | ConversationUserField | TicketUserField | CallUserField | CanvasUserField | MessageAttachmentUserField;

/**
 * MessageAttachment enriched with base64 content
 * Used when querying MessageAttachment via getContext
 */
export interface EnrichedMessageAttachment extends MessageAttachment {
  base64Content: string | null;
  dataUri: string | null;
  mediaCategory: string | null;
  messageId: string | null;
  ticketId: string | null;
}


export interface EnrichedCall extends Call {
  conversationId: string | null;
}



export interface EnrichedCanvas extends Canvas {
  /** Conversation ID (always null for Canvas) */
  conversationId: string | null;
}

/**
 * Common filter parameters for context retrieval
 */
export interface ContextFilterParams {
  /** Primary key ID of the record */
  id?: string;
  /** Time range filter - applied to the specified dateField (or default for schema) */
  timeRange?: TimeRangeFilter;

  dateField?: DateFieldName;
  /** User ID filter - applied to relevant user fields based on schema */
  userId?: string;

  userField?: UserFieldName;
  /** Maximum number of records to return */
  limit?: number;
  /** Number of records to skip (for pagination) */
  offset?: number;
  /** Order by field and direction */
  orderBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
}

/**
 * Result wrapper for context retrieval
 */
export interface ContextResult<T> {
  /** Retrieved data */
  data: T[];
  /** Total count (before limit/offset) */
  total: number;
  /** Schema name that was queried */
  schema: ContextSchemaName;
  /** Applied filters (for debugging/logging) - properly typed Prisma WhereInput */
  appliedFilters:
    | Prisma.MessageWhereInput
    | Prisma.ConversationWhereInput
    | Prisma.TicketWhereInput
    | Prisma.CallWhereInput
    | Prisma.CanvasWhereInput
    | Prisma.MessageAttachmentWhereInput;
}


interface SchemaFieldMapping<T = any> {
  idField: keyof T & string;
  dateFields: Array<{[K in keyof T]: T[K] extends Date | null ? K : never}[keyof T]>;
  defaultDateField: {[K in keyof T]: T[K] extends Date | null ? K : never}[keyof T];
  userFields: Array<{[K in keyof T]: T[K] extends string | null ? K : never}[keyof T]>;
  defaultUserField: {[K in keyof T]: T[K] extends string | null ? K : never}[keyof T];
  defaultOrderField: keyof T & string;
}

// ============================================================================
// Constants
// ============================================================================


const DEFAULT_LIMIT = 100;


const MAX_LIMIT = 500;


function createFieldMapping<T>(config: SchemaFieldMapping<T>): SchemaFieldMapping<T> {
  return config;
}


const SCHEMA_FIELD_MAPPINGS = {
  Message: createFieldMapping<Message>({
    idField: 'messageId' satisfies keyof Message,
    dateFields: ['createdAt' satisfies MessageDateField] as const,
    defaultDateField: 'createdAt' satisfies MessageDateField,
    userFields: ['senderId' satisfies MessageUserField] as const,
    defaultUserField: 'senderId' satisfies MessageUserField,
    defaultOrderField: 'createdAt' satisfies keyof Message,
  }),
  Conversation: createFieldMapping<Conversation>({
    idField: 'conversationId' satisfies keyof Conversation,
    dateFields: ['createdAt' satisfies ConversationDateField, 'lastActivityAt' satisfies ConversationDateField] as const,
    defaultDateField: 'lastActivityAt' satisfies ConversationDateField,
    userFields: ['createdBy' satisfies ConversationUserField] as const,
    defaultUserField: 'createdBy' satisfies ConversationUserField,
    defaultOrderField: 'lastActivityAt' satisfies keyof Conversation,
  }),
  Ticket: createFieldMapping<Ticket>({
    idField: 'id' satisfies keyof Ticket,
    dateFields: ['createdAt' satisfies TicketDateField, 'updatedAt' satisfies TicketDateField, 'closedAt' satisfies TicketDateField, 'eta' satisfies TicketDateField] as const,
    defaultDateField: 'createdAt' satisfies TicketDateField,
    userFields: ['createdBy' satisfies TicketUserField, 'updatedBy' satisfies TicketUserField, 'assignedTo' satisfies TicketUserField, 'closedBy' satisfies TicketUserField] as const,
    defaultUserField: 'createdBy' satisfies TicketUserField,
    defaultOrderField: 'createdAt' satisfies keyof Ticket,
  }),
  Call: createFieldMapping<Call>({
    idField: 'id' satisfies keyof Call,
    dateFields: ['createdAt' satisfies CallDateField, 'updatedAt' satisfies CallDateField, 'startedAt' satisfies CallDateField, 'endedAt' satisfies CallDateField, 'lastActivityAt' satisfies CallDateField, 'startsAt' satisfies CallDateField, 'endsAt' satisfies CallDateField] as const,
    defaultDateField: 'startedAt' satisfies CallDateField,
    userFields: ['createdByUserId' satisfies CallUserField, 'organizerId' satisfies CallUserField] as const,
    defaultUserField: 'createdByUserId' satisfies CallUserField,
    defaultOrderField: 'startedAt' satisfies keyof Call,
  }),
  Canvas: createFieldMapping<Canvas>({
    idField: 'id' satisfies keyof Canvas,
    dateFields: ['createdAt' satisfies CanvasDateField, 'updatedAt' satisfies CanvasDateField, 'lastEditedAt' satisfies CanvasDateField] as const,
    defaultDateField: 'updatedAt' satisfies CanvasDateField,
    userFields: ['createdBy' satisfies CanvasUserField, 'lastEditedBy' satisfies CanvasUserField] as const,
    defaultUserField: 'createdBy' satisfies CanvasUserField,
    defaultOrderField: 'updatedAt' satisfies keyof Canvas,
  }),
  MessageAttachment: createFieldMapping<MessageAttachment>({
    idField: 'id' satisfies keyof MessageAttachment,
    dateFields: ['createdAt' satisfies MessageAttachmentDateField] as const,
    defaultDateField: 'createdAt' satisfies MessageAttachmentDateField,
    userFields: ['uploadedByUserId' satisfies MessageAttachmentUserField, 'createdBy' satisfies MessageAttachmentUserField] as const,
    defaultUserField: 'uploadedByUserId' satisfies MessageAttachmentUserField,
    defaultOrderField: 'createdAt' satisfies keyof MessageAttachment,
  }),
} as const satisfies Record<ContextSchemaName, SchemaFieldMapping>;

// ============================================================================
// AI Context Service Class
// ============================================================================

/**
 * Service for retrieving context data from various schemas for AI/LLM consumption
 */
export class AiContextService {
  private db: ReturnType<typeof DatabaseClient.getInstance>;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Retrieve context from a specified schema with flexible filtering
   *
   * @param schemaName - The schema to query (Message, Conversation, Ticket, Call, Canvas)
   * @param params - Filter parameters (id, timeRange, userId, limit, offset, orderBy)
   * @returns Promise<ContextResult<T>> - Retrieved data with metadata
   *
   * @example
   * // Get messages by sender within a time range
   * const result = await aiContextService.getContext('Message', {
   *   userId: 'user123',
   *   timeRange: { start: new Date('2024-01-01'), end: new Date() },
   *   limit: 50
   * });
   *
   * @example
   * // Get a specific ticket by ID
   * const result = await aiContextService.getContext('Ticket', {
   *   id: 'ticket123'
   * });
   */
  async getContext<T = unknown>(
    schemaName: ContextSchemaName,
    params: ContextFilterParams = {}
  ): Promise<ContextResult<T>> {
    logger.info(`[AiContextService] Fetching context from schema: ${schemaName}`, { params });

    try {
      const fieldMapping = SCHEMA_FIELD_MAPPINGS[schemaName];
      if (!fieldMapping) {
        throw new Error(`Unsupported schema: ${schemaName}`);
      }

      // Build the where clause based on params and schema
      const whereClause = this.buildWhereClause(schemaName, params, fieldMapping);

      // Build order by clause
      const orderByClause = this.buildOrderByClause(params, fieldMapping);

      // Execute query based on schema
      const { data, total } = await this.executeQuery<T>(
        schemaName,
        whereClause,
        orderByClause,
        params.limit,
        params.offset
      );

      logger.info(`[AiContextService] Retrieved ${data.length} records from ${schemaName}`, {
        total,
        appliedFilters: whereClause,
      });

      return {
        data,
        total,
        schema: schemaName,
        appliedFilters: whereClause,
      };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching context from ${schemaName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve a single record by ID from a specified schema
   *
   * @param schemaName - The schema to query
   * @param id - Primary key ID of the record
   * @returns Promise<T | null> - The record or null if not found
   */
  async getById<T = unknown>(
    schemaName: ContextSchemaName,
    id: string
  ): Promise<T | null> {
    logger.info(`[AiContextService] Fetching single record from ${schemaName} by ID: ${id}`);

    try {
      const fieldMapping = SCHEMA_FIELD_MAPPINGS[schemaName];
      if (!fieldMapping) {
        throw new Error(`Unsupported schema: ${schemaName}`);
      }

      const result = await this.executeFindUnique<T>(schemaName, id, fieldMapping);

      if (result) {
        logger.info(`[AiContextService] Found record in ${schemaName} with ID: ${id}`);
      } else {
        logger.info(`[AiContextService] No record found in ${schemaName} with ID: ${id}`);
      }

      return result;
    } catch (error) {
      logger.error(`[AiContextService] Error fetching record from ${schemaName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve messages for a specific conversation
   *
   * @param conversationId - The conversation ID
   * @param params - Additional filter parameters
   * @returns Promise<ContextResult<Message>> - Messages with metadata
   */
  async getMessagesByConversation(
    conversationId: string,
    params: Omit<ContextFilterParams, 'id'> = {}
  ): Promise<ContextResult<Message>> {
    logger.info(`[AiContextService] Fetching messages for conversation: ${conversationId}`);

    try {
      const whereClause: Prisma.MessageWhereInput = {
        conversationId,
        isDeleted: false,
      };

      // Apply time range filter
      if (params.timeRange) {
        whereClause.createdAt = this.buildTimeRangeFilter(params.timeRange);
      }

      // Apply user filter
      if (params.userId) {
        whereClause.senderId = params.userId;
      }

      const orderBy = params.orderBy
        ? { [params.orderBy.field]: params.orderBy.direction }
        : { createdAt: 'desc' as const };

      const [data, total] = await Promise.all([
        this.db.message.findMany({
          where: whereClause,
          orderBy,
          take: params.limit,
          skip: params.offset,
        }),
        this.db.message.count({ where: whereClause }),
      ]);

      return {
        data,
        total,
        schema: 'Message',
        appliedFilters: whereClause,
      };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching messages for conversation:`, error);
      throw error;
    }
  }

  /**
   * Retrieve conversations for a specific channel
   *
   * @param channelId - The channel ID
   * @param params - Additional filter parameters
   * @returns Promise<ContextResult<Conversation>> - Conversations with metadata
   */
  async getConversationsByChannel(
    channelId: string,
    params: Omit<ContextFilterParams, 'id'> = {}
  ): Promise<ContextResult<Conversation>> {
    logger.info(`[AiContextService] Fetching conversations for channel: ${channelId}`);

    try {
      const whereClause: Prisma.ConversationWhereInput = {
        channelId,
      };

      // Apply time range filter to lastActivityAt (most relevant for conversations)
      if (params.timeRange) {
        whereClause.lastActivityAt = this.buildTimeRangeFilter(params.timeRange);
      }

      // Apply user filter
      if (params.userId) {
        whereClause.createdBy = params.userId;
      }

      const orderBy = params.orderBy
        ? { [params.orderBy.field]: params.orderBy.direction }
        : { lastActivityAt: 'desc' as const };

      const [data, total] = await Promise.all([
        this.db.conversation.findMany({
          where: whereClause,
          orderBy,
          take: params.limit,
          skip: params.offset,
        }),
        this.db.conversation.count({ where: whereClause }),
      ]);

      return {
        data,
        total,
        schema: 'Conversation',
        appliedFilters: whereClause,
      };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching conversations for channel:`, error);
      throw error;
    }
  }

  /**
   * Retrieve tickets for a specific project or board
   *
   * @param projectId - Optional project ID filter
   * @param boardId - Optional board ID filter
   * @param params - Additional filter parameters
   * @returns Promise<ContextResult<Ticket>> - Tickets with metadata
   */
  async getTicketsByProject(
    projectId?: string,
    boardId?: string,
    params: Omit<ContextFilterParams, 'id'> = {}
  ): Promise<ContextResult<Ticket>> {
    logger.info(`[AiContextService] Fetching tickets`, { projectId, boardId });

    try {
      const whereClause: Prisma.TicketWhereInput = {};

      if (projectId) {
        whereClause.projectId = projectId;
      }

      if (boardId) {
        whereClause.boardId = boardId;
      }

      // Apply time range filter
      if (params.timeRange) {
        whereClause.createdAt = this.buildTimeRangeFilter(params.timeRange);
      }

      // Apply user filter (createdBy or assignedTo)
      if (params.userId) {
        whereClause.OR = [
          { createdBy: params.userId },
          { assignedTo: params.userId },
        ];
      }

      const orderBy = params.orderBy
        ? { [params.orderBy.field]: params.orderBy.direction }
        : { createdAt: 'desc' as const };

      const [data, total] = await Promise.all([
        this.db.ticket.findMany({
          where: whereClause,
          orderBy,
          take: params.limit,
          skip: params.offset,
        }),
        this.db.ticket.count({ where: whereClause }),
      ]);

      return {
        data,
        total,
        schema: 'Ticket',
        appliedFilters: whereClause,
      };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching tickets:`, error);
      throw error;
    }
  }

  /**
   * Retrieve calls for a specific channel or user
   *
   * @param channelId - Optional channel ID filter
   * @param params - Additional filter parameters
   * @returns Promise<ContextResult<Call>> - Calls with metadata
   */
  async getCallsByChannel(
    channelId?: string,
    params: Omit<ContextFilterParams, 'id'> = {}
  ): Promise<ContextResult<EnrichedCall>> {
    logger.info(`[AiContextService] Fetching calls`, { channelId });

    try {
      const whereClause: Prisma.CallWhereInput = {};

      if (channelId) {
        whereClause.channelId = channelId;
      }

      // Apply time range filter to startedAt
      if (params.timeRange) {
        whereClause.startedAt = this.buildTimeRangeFilter(params.timeRange);
      }

      // Apply user filter
      if (params.userId) {
        whereClause.OR = [
          { createdByUserId: params.userId },
          { organizerId: params.userId },
        ];
      }

      const orderBy = params.orderBy
        ? { [params.orderBy.field]: params.orderBy.direction }
        : { startedAt: 'desc' as const };

      const [calls, total] = await Promise.all([
        this.db.call.findMany({
          where: whereClause,
          orderBy,
          take: params.limit,
          skip: params.offset,
        }),
        this.db.call.count({ where: whereClause }),
      ]);

      // Enrich each call with conversationId extracted from metadata (same as getContext does)
      const enrichedData = calls.map((call) => {
        let conversationId: string | null = null;

        // Extract conversationId from metadata JSON if present
        if (call.metadata && typeof call.metadata === 'object') {
          const metadata = call.metadata as Record<string, unknown>;
          if (typeof metadata.conversationId === 'string') {
            conversationId = metadata.conversationId;
            logger.debug(`[AiContextService] Call ${call.id} enriched with conversationId: ${conversationId}`);
          } else {
            logger.debug(`[AiContextService] Call ${call.id} missing conversationId in metadata. Available keys: ${Object.keys(metadata).join(', ')}`);
          }
        } else {
          logger.debug(`[AiContextService] Call ${call.id} has no metadata or metadata is not an object`);
        }

        return {
          ...call,
          conversationId,
        } as EnrichedCall;
      });

      const callsWithConvId = enrichedData.filter(c => c.conversationId).length;
      logger.info(`[AiContextService] Enriched ${enrichedData.length} calls, ${callsWithConvId} have conversationId`);

      return {
        data: enrichedData,
        total,
        schema: 'Call',
        appliedFilters: whereClause,
      };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching calls:`, error);
      throw error;
    }
  }

  /**
   * Retrieve attachments for a conversation with optional base64 conversion
   *
   * @param conversationId - The conversation ID
   * @param options - Base64 conversion options
   * @returns Promise<{ attachments, base64Attachments }> - Raw attachments and base64 versions
   *
   * @example
   * const { attachments, base64Attachments } = await aiContextService.getAttachmentsByConversation(
   *   'conv123',
   *   { allowedCategories: ['image', 'video'], preferThumbnail: true }
   * );
   */
  async getAttachmentsByConversation(
    conversationId: string,
    options: Base64ConversionOptions = {}
  ): Promise<{
    attachments: MessageAttachment[];
    base64Attachments: Base64AttachmentResult[];
  }> {
    logger.info(`[AiContextService] Fetching attachments for conversation: ${conversationId}`);

    try {
      const attachments = await this.db.messageAttachment.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
      });

      logger.info(`[AiContextService] Found ${attachments.length} attachments for conversation`);

      // Convert to base64
      const base64Attachments = await convertManyToBase64(attachments, options);

      return { attachments, base64Attachments };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching attachments:`, error);
      throw error;
    }
  }

  /**
   * Retrieve a single attachment by ID with optional base64 conversion
   *
   * @param attachmentId - The attachment ID
   * @param options - Base64 conversion options
   * @returns Promise<{ attachment, base64 }> - Attachment and base64 version
   */
  async getAttachmentById(
    attachmentId: string,
    options: Base64ConversionOptions = {}
  ): Promise<{
    attachment: MessageAttachment | null;
    base64: Base64AttachmentResult | null;
  }> {
    logger.info(`[AiContextService] Fetching attachment by ID: ${attachmentId}`);

    try {
      const attachment = await this.db.messageAttachment.findUnique({
        where: { id: attachmentId },
      });

      if (!attachment) {
        return { attachment: null, base64: null };
      }

      const base64 = await convertToBase64(attachment, options);

      return { attachment, base64 };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching attachment:`, error);
      throw error;
    }
  }

  /**
   * Retrieve only image/video attachments as base64 (for AI image analysis)
   *
   * @param conversationId - The conversation ID
   * @param preferThumbnail - Use thumbnails if available (default: false)
   * @returns Promise<Base64AttachmentResult[]> - Image/video attachments as base64
   */
  async getMediaAttachmentsAsBase64(
    conversationId: string,
    preferThumbnail = false
  ): Promise<Base64AttachmentResult[]> {
    logger.info(`[AiContextService] Fetching media attachments for conversation: ${conversationId}`);

    try {
      const attachments = await this.db.messageAttachment.findMany({
        where: {
          conversationId,
          mimetype: {
            startsWith: 'image/',
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Also get videos
      const videoAttachments = await this.db.messageAttachment.findMany({
        where: {
          conversationId,
          mimetype: {
            startsWith: 'video/',
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const allMedia = [...attachments, ...videoAttachments];
      logger.info(`[AiContextService] Found ${allMedia.length} media attachments`);

      return convertMediaToBase64(allMedia, preferThumbnail);
    } catch (error) {
      logger.error(`[AiContextService] Error fetching media attachments:`, error);
      throw error;
    }
  }

  /**
   * Retrieve canvases for a specific channel or user
   *
   * @param channelId - Optional channel ID filter
   * @param params - Additional filter parameters
   * @returns Promise<ContextResult<Canvas>> - Canvases with metadata
   */
  async getCanvasesByChannel(
    channelId?: string,
    params: Omit<ContextFilterParams, 'id'> = {}
  ): Promise<ContextResult<Canvas>> {
    logger.info(`[AiContextService] Fetching canvases`, { channelId });

    try {
      const whereClause: Prisma.CanvasWhereInput = {};

      if (channelId) {
        whereClause.channelId = channelId;
      }

      // Apply time range filter to updatedAt or lastEditedAt
      if (params.timeRange) {
        whereClause.updatedAt = this.buildTimeRangeFilter(params.timeRange);
      }

      // Apply user filter - include canvases where user is creator, editor, or participant
      if (params.userId) {
        // First, get canvas IDs where user is a participant
        const participantCanvases = await this.db.canvasParticipant.findMany({
          where: { userId: params.userId },
          select: { canvasId: true },
        });

        const participantCanvasIds = participantCanvases.map(p => p.canvasId);

        whereClause.OR = [
          { createdBy: params.userId },
          { lastEditedBy: params.userId },
          ...(participantCanvasIds.length > 0 ? [{ id: { in: participantCanvasIds } }] : []),
        ];
      }

      const orderBy = params.orderBy
        ? { [params.orderBy.field]: params.orderBy.direction }
        : { updatedAt: 'desc' as const };

      const [data, total] = await Promise.all([
        this.db.canvas.findMany({
          where: whereClause,
          orderBy,
          take: params.limit,
          skip: params.offset,
        }),
        this.db.canvas.count({ where: whereClause }),
      ]);

      return {
        data,
        total,
        schema: 'Canvas',
        appliedFilters: whereClause,
      };
    } catch (error) {
      logger.error(`[AiContextService] Error fetching canvases:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Build time range filter for Prisma queries
   */
  private buildTimeRangeFilter(timeRange: TimeRangeFilter): Prisma.DateTimeFilter {
    const filter: Prisma.DateTimeFilter = {};

    if (timeRange.start) {
      filter.gte = timeRange.start;
    }

    if (timeRange.end) {
      filter.lte = timeRange.end;
    }

    return filter;
  }

  /**
   * Build where clause based on schema and parameters
   * Returns properly typed Prisma WhereInput for the schema
   */
  private buildWhereClause(
    schemaName: ContextSchemaName,
    params: ContextFilterParams,
    fieldMapping: SchemaFieldMapping
  ): 
    | Prisma.MessageWhereInput
    | Prisma.ConversationWhereInput
    | Prisma.TicketWhereInput
    | Prisma.CallWhereInput
    | Prisma.CanvasWhereInput
    | Prisma.MessageAttachmentWhereInput {
    
    // Build where clause based on schema type
    switch (schemaName) {
      case 'Message': {
        const where: Prisma.MessageWhereInput = {
          isDeleted: false, // Always filter deleted messages
        };

        if (params.id) {
          where.messageId = params.id;
        }

        if (params.timeRange) {
          const dateField = params.dateField || fieldMapping.defaultDateField;
          if (dateField === 'createdAt' || !params.dateField) {
            where.createdAt = this.buildTimeRangeFilter(params.timeRange);
          }
        }

        if (params.userId) {
          const userField = params.userField || fieldMapping.defaultUserField;
          if (userField === 'senderId' || !params.userField) {
            where.senderId = params.userId;
          } else if (userField === 'visibleTo') {
            where.visibleTo = params.userId;
          }
        }

        return where;
      }

      case 'Conversation': {
        const where: Prisma.ConversationWhereInput = {};

        if (params.id) {
          where.conversationId = params.id;
        }

        if (params.timeRange) {
          const dateField = params.dateField || fieldMapping.defaultDateField;
          if (dateField === 'lastActivityAt' || !params.dateField) {
            where.lastActivityAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'createdAt') {
            where.createdAt = this.buildTimeRangeFilter(params.timeRange);
          }
        }

        if (params.userId) {
          where.createdBy = params.userId;
        }

        return where;
      }

      case 'Ticket': {
        const where: Prisma.TicketWhereInput = {};

        if (params.id) {
          where.id = params.id;
        }

        if (params.timeRange) {
          const dateField = params.dateField || fieldMapping.defaultDateField;
          if (dateField === 'createdAt' || !params.dateField) {
            where.createdAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'updatedAt') {
            where.updatedAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'closedAt') {
            where.closedAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'eta') {
            where.eta = this.buildTimeRangeFilter(params.timeRange);
          }
        }

        if (params.userId) {
          const userField = params.userField || fieldMapping.defaultUserField;
          if (userField === 'createdBy' || !params.userField) {
            where.createdBy = params.userId;
          } else if (userField === 'assignedTo') {
            where.assignedTo = params.userId;
          } else if (userField === 'updatedBy') {
            where.updatedBy = params.userId;
          } else if (userField === 'closedBy') {
            where.closedBy = params.userId;
          }
        }

        return where;
      }

      case 'Call': {
        const where: Prisma.CallWhereInput = {};

        if (params.id) {
          where.id = params.id;
        }

        if (params.timeRange) {
          const dateField = params.dateField || fieldMapping.defaultDateField;
          if (dateField === 'startedAt' || !params.dateField) {
            where.startedAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'createdAt') {
            where.createdAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'updatedAt') {
            where.updatedAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'endedAt') {
            where.endedAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'lastActivityAt') {
            where.lastActivityAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'startsAt') {
            where.startsAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'endsAt') {
            where.endsAt = this.buildTimeRangeFilter(params.timeRange);
          }
        }

        if (params.userId) {
          const userField = params.userField || fieldMapping.defaultUserField;
          if (userField === 'createdByUserId' || !params.userField) {
            where.createdByUserId = params.userId;
          } else if (userField === 'organizerId') {
            where.organizerId = params.userId;
          }
        }

        return where;
      }

      case 'Canvas': {
        const where: Prisma.CanvasWhereInput = {};

        if (params.id) {
          where.id = params.id;
        }

        if (params.timeRange) {
          const dateField = params.dateField || fieldMapping.defaultDateField;
          if (dateField === 'updatedAt' || !params.dateField) {
            where.updatedAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'createdAt') {
            where.createdAt = this.buildTimeRangeFilter(params.timeRange);
          } else if (dateField === 'lastEditedAt') {
            where.lastEditedAt = this.buildTimeRangeFilter(params.timeRange);
          }
        }

        if (params.userId) {
          const userField = params.userField || fieldMapping.defaultUserField;
          if (userField === 'createdBy' || !params.userField) {
            where.createdBy = params.userId;
          } else if (userField === 'lastEditedBy') {
            where.lastEditedBy = params.userId;
          }
        }

        return where;
      }

      case 'MessageAttachment': {
        const where: Prisma.MessageAttachmentWhereInput = {};

        if (params.id) {
          where.id = params.id;
        }

        if (params.timeRange) {
          where.createdAt = this.buildTimeRangeFilter(params.timeRange);
        }

        if (params.userId) {
          const userField = params.userField || fieldMapping.defaultUserField;
          if (userField === 'uploadedByUserId' || !params.userField) {
            where.uploadedByUserId = params.userId;
          } else if (userField === 'createdBy') {
            where.createdBy = params.userId;
          }
        }

        return where;
      }

      default:
        // TypeScript will ensure this is exhaustive
        throw new Error(`Unsupported schema: ${schemaName}`);
    }
  }

  /**
   * Build order by clause
   */
  private buildOrderByClause(
    params: ContextFilterParams,
    fieldMapping: SchemaFieldMapping
  ): Record<string, 'asc' | 'desc'> {
    if (params.orderBy) {
      return { [params.orderBy.field]: params.orderBy.direction };
    }

    return { [fieldMapping.defaultOrderField]: 'desc' };
  }

  /**
   * Execute query for the specified schema
   * Uses properly typed Prisma WhereInput for type safety
   */
  private async executeQuery<T>(
    schemaName: ContextSchemaName,
    whereClause:
      | Prisma.MessageWhereInput
      | Prisma.ConversationWhereInput
      | Prisma.TicketWhereInput
      | Prisma.CallWhereInput
      | Prisma.CanvasWhereInput
      | Prisma.MessageAttachmentWhereInput,
    orderByClause: Record<string, 'asc' | 'desc'>,
    limit?: number,
    offset?: number
  ): Promise<{ data: T[]; total: number }> {
    // Apply default limit if not specified, and cap at MAX_LIMIT
    const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Log warning if no filters and no explicit limit provided
    const hasFilters = Object.keys(whereClause).some(
      (key) => key !== 'isDeleted' // isDeleted is always added for Message schema
    );
    if (!hasFilters && limit === undefined) {
      logger.warn(
        `[AiContextService] Querying ${schemaName} without filters. ` +
        `Applying default limit of ${DEFAULT_LIMIT} records. ` +
        `Pass an explicit limit to override.`
      );
    }

    const queryOptions = {
      where: whereClause,
      orderBy: orderByClause,
      take: effectiveLimit,
      ...(offset && { skip: offset }),
    };

    switch (schemaName) {
      case 'Message': {
        const [data, total] = await Promise.all([
          this.db.message.findMany(queryOptions as Prisma.MessageFindManyArgs),
          this.db.message.count({ where: whereClause as Prisma.MessageWhereInput }),
        ]);
        return { data: data as T[], total };
      }

      case 'Conversation': {
        const [data, total] = await Promise.all([
          this.db.conversation.findMany(queryOptions as Prisma.ConversationFindManyArgs),
          this.db.conversation.count({ where: whereClause as Prisma.ConversationWhereInput }),
        ]);
        return { data: data as T[], total };
      }

      case 'Ticket': {
        const [data, total] = await Promise.all([
          this.db.ticket.findMany(queryOptions as Prisma.TicketFindManyArgs),
          this.db.ticket.count({ where: whereClause as Prisma.TicketWhereInput }),
        ]);
        return { data: data as T[], total };
      }

      case 'Call': {
        const [calls, total] = await Promise.all([
          this.db.call.findMany(queryOptions as Prisma.CallFindManyArgs),
          this.db.call.count({ where: whereClause as Prisma.CallWhereInput }),
        ]);

        // Enrich each call with conversationId extracted from metadata
        const enrichedData = calls.map((call) => {
          let conversationId: string | null = null;

          // Extract conversationId from metadata JSON if present
          if (call.metadata && typeof call.metadata === 'object') {
            const metadata = call.metadata as Record<string, unknown>;
            if (typeof metadata.conversationId === 'string') {
              conversationId = metadata.conversationId;
            } else {
              // Log when conversationId is missing to help debug citation issues
              logger.debug(`[AiContextService] Call ${call.id} missing conversationId in metadata. Available keys: ${Object.keys(metadata).join(', ')}`);
            }
          } else {
            logger.debug(`[AiContextService] Call ${call.id} has no metadata or metadata is not an object`);
          }

          return {
            ...call,
            conversationId,
          } as EnrichedCall;
        });

        return { data: enrichedData as T[], total };
      }

      case 'Canvas': {
        const [canvases, total] = await Promise.all([
          this.db.canvas.findMany(queryOptions as Prisma.CanvasFindManyArgs),
          this.db.canvas.count({ where: whereClause as Prisma.CanvasWhereInput }),
        ]);

        // Enrich each canvas with conversationId as null (Canvas doesn't have conversationId)
        const enrichedData = canvases.map((canvas) => ({
          ...canvas,
          conversationId: null,
        } as EnrichedCanvas));

        return { data: enrichedData as T[], total };
      }

      case 'MessageAttachment': {
        const [attachments, total] = await Promise.all([
          this.db.messageAttachment.findMany(queryOptions as Prisma.MessageAttachmentFindManyArgs),
          this.db.messageAttachment.count({ where: whereClause as Prisma.MessageAttachmentWhereInput }),
        ]);

        // Enrich each attachment with base64 content and entity-specific ID fields
        // Always determine mediaCategory from mimetype even if file fetch fails
        const enrichedData = await Promise.all(
          attachments.map(async (attachment) => {
            // Always determine mediaCategory from mimetype (doesn't require GCS fetch)
            const mediaCategory = getMediaCategory(attachment.mimetype);

            // Add messageId or ticketId based on entityType
            // entityType is 'CHAT' | 'TICKET' | 'CANVAS' | 'EMAIL'
            const messageId = attachment.entityType === 'CHAT' ? attachment.entityId : null;
            const ticketId = attachment.entityType === 'TICKET' ? attachment.entityId : null;

            try {
              const base64Result = await convertToBase64(attachment);
              return {
                ...attachment,
                base64Content: base64Result?.base64Content ?? null,
                dataUri: base64Result?.dataUri ?? null,
                mediaCategory,
                messageId,
                ticketId,
              } as EnrichedMessageAttachment;
            } catch (error) {
              // If GCS fetch fails, still return the attachment with null base64 but valid mediaCategory
              logger.warn(`[AiContextService] Failed to fetch base64 for attachment ${attachment.id}:`, error);
              return {
                ...attachment,
                base64Content: null,
                dataUri: null,
                mediaCategory,
                messageId,
                ticketId,
              } as EnrichedMessageAttachment;
            }
          })
        );

        return { data: enrichedData as T[], total };
      }

      default:
        throw new Error(`Unsupported schema: ${schemaName}`);
    }
  }

  /**
   * Execute find unique query for the specified schema
   */
  private async executeFindUnique<T>(
    schemaName: ContextSchemaName,
    id: string,
    _fieldMapping: SchemaFieldMapping
  ): Promise<T | null> {
    switch (schemaName) {
      case 'Message':
        return this.db.message.findUnique({
          where: { messageId: id },
        }) as Promise<T | null>;

      case 'Conversation':
        return this.db.conversation.findUnique({
          where: { conversationId: id },
        }) as Promise<T | null>;

      case 'Ticket':
        return this.db.ticket.findUnique({
          where: { id },
        }) as Promise<T | null>;

      case 'Call':
        return this.db.call.findUnique({
          where: { id },
        }) as Promise<T | null>;

      case 'Canvas':
        return this.db.canvas.findUnique({
          where: { id },
        }) as Promise<T | null>;

      case 'MessageAttachment':
        return this.db.messageAttachment.findUnique({
          where: { id },
        }) as Promise<T | null>;

      default:
        throw new Error(`Unsupported schema: ${schemaName}`);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Singleton instance of AiContextService */
export const aiContextService = new AiContextService();
