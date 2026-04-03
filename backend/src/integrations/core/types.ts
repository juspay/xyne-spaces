/**
 * Core types for external source integration system
 * Platform-agnostic interfaces
 */

import { ExternalSource } from '@prisma/client';

/**
 * Supported external source platforms
 * Add new platforms here when creating new adapters
 */
export enum ExternalSourcePlatform {
  ZOHO = 'zoho',
  SLACK = 'slack',
}

/**
 * Generic parser interface
 * All platform adapters must implement this
 */
export interface Parser<TRaw, TNormalized> {
  /**
   * Parse raw payload into normalized format
   */
  parse(rawPayload: TRaw): Promise<ParseResult<TNormalized>>;

  /**
   * Validate payload structure before parsing
   */
  validate(rawPayload: TRaw): boolean;
}

/**
 * Normalized data (platform-agnostic)
 * All parsers must output this format
 */
export interface NormalizedData {
  externalId: string; // Unique message ID from external system
  externalThreadId: string; // Thread/ticket ID
  externalParentId?: string; // Parent message ID (for replies)

  author: {
    name: string;
    email?: string;
    externalId?: string;
  };

  content: string; // Message body (HTML format - subject and description combined in div)

  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    mimeType?: string;
    size?: number;
  }>;

  // Email-specific fields (optional - for email-based integrations like Zoho)
  emailData?: {
    subject?: string;
    to?: string[];
    from?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
  };

  metadata: {
    eventType: string; // "ticket.created", "comment.added", etc.
    timestamp: Date;
    ticketNumber?: string;
    webUrl?: string;
    
    // Zoho-specific fields
    ticketId?: string;
    threadId?: string; // Individual email/thread ID (payload.id)
    channel?: string; // "Email", "Phone", "Web", etc.
    status?: string;
    priority?: string;
    departmentId?: string;
    contactId?: string;
    contactEmail?: string;
    fromEmailAddress?: string;
    hasAttachments?: boolean;
    attachmentCount?: number;
    isReply?: boolean; // true for Ticket_Thread_Add events
    
    [key: string]: string | number | boolean | Date | string[] | undefined; // Platform-specific metadata
  };
}

/**
 * Authentication result
 * Returned by adapter.authenticate()
 */
export interface AuthResult {
  authenticated: boolean;
  skipProcessing?: boolean; // Set to true for test webhooks, health checks, etc.
  reason?: string; // Optional reason for skipping (e.g., "test_webhook")
  metadata?: Record<string, any>;
}

/**
 * Postprocess context
 * Passed to adapter.postprocess() after conversation/message creation
 */
export interface PostprocessContext {
  conversationId: string;
  entityId: string;
  sourceId: string;
  normalizedData: NormalizedData;
}

/**
 * Parse result wrapper
 */
export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Ingestion result
 */
export interface IngestionResult {
  success: boolean;
  conversationId: string;
  entityId: string;
  action: 'created' | 'updated' | 'duplicate';
}

/**
 * Test payload check result
 * Returned by adapter.isTestPayload()
 */
export interface TestPayloadResult {
  isTest: boolean;
  response?: {
    status: number;
    body: any;
  };
}

/**
 * External Source Adapter Interface
 * All platform adapters must implement this
 */
export interface ExternalSourceAdapter {
  /** Platform name (e.g., "zoho", "slack") */
  name: string;

  /** Authenticate incoming request (JWT, HMAC, etc.) and check if processing should be skipped */
  authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    secret: string,
    sourceName: string
  ): Promise<AuthResult>;

  /** Optional: Preprocess payload (fetch additional data via API) */
  preprocess?(rawPayload: unknown, source?: ExternalSource): Promise<unknown>;

  /** Optional: Dynamically determine source name for database lookup based on payload */
  getSourceNameFromDB?(payload: unknown): string | undefined;

  /** Optional: Check if the payload is a test payload and return response if it is */
  isTestPayload?(payload: unknown): TestPayloadResult;

  /** Transform platform-specific data to NormalizedData */
  transform(payload: unknown): Promise<ParseResult<NormalizedData>>;

  /** Optional: Postprocess after conversation/message creation (e.g., create tickets, trigger workflows) */
  postprocess?(context: PostprocessContext): Promise<void>;
}
