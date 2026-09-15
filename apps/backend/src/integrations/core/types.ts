/**
 * Core types for external source integration system
 * Platform-agnostic interfaces
 */

import type { ExternalSource } from '@prisma/client';
import type { EmailType, FormFieldType } from '@xyne/shared';
import { RefetchOptions, RefetchResult } from './baseRefetch';
import type { DownloadedAttachment } from '@/services/externalAttachmentService';
export type { RefetchOptions, RefetchResult };

/**
 * Supported external source platforms
 * Add new platforms here when creating new adapters
 */
export enum ExternalSourcePlatform {
  ZOHO = 'zoho',
  SLACK = 'slack',
  SLACK_DESK = 'slack-desk',
  MICROSOFT = 'microsoft',
  GOOGLE = 'google',
  APP_DESK = 'app-desk',
  OZONETEL = 'ozonetel',
  GOOGLE_PLAY = 'google-play-reviews',
}

export interface IngestionOptions {
  /** Bypass the source's persisted cursor for an explicit full/manual fetch. */
  ignoreSyncCursor?: boolean;
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
  rfcMessageId?: string; // RFC Message-ID header, stable across mailboxes
  referencedMessageIds?: string[]; // RFC Message-IDs from In-Reply-To + References headers
  /** Workspace user that should own newly created conversations and tickets. */
  creatorUserId?: string;

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
    /** MIME Content-ID (no angle brackets) for inline images from the body. */
    contentId?: string;
    /** Extra metadata to forward onto the stored MessageAttachment row. */
    metadata?: Record<string, unknown>;
  }>;

  /**
   * Attachments already uploaded to GCS by the flow/preprocessor (Gmail,
   * Microsoft Graph). When set, core ingestion uses these directly.
   */
  preDownloadedAttachments?: DownloadedAttachment[];

  // Email-specific fields (optional - for email-based integrations like Zoho)
  emailData?: {
    subject?: string;
    to?: string[];
    from?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
    type?: EmailType;
    sentByUserId?: string;
    rating?: number;
    clientVersionName?: string;
    clientVersionCode?: string;
    updateExisting?: boolean;
    syncTicketOnUpdate?: boolean;
  };

  ticketCustomFields?: Array<{
    fieldName: string;
    fieldType: FormFieldType;
    value: string;
  }>;

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
  action: 'created' | 'updated' | 'duplicate' | 'skipped';
  isNew?: boolean;
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

  /** True when the adapter is ingested by a scheduled provider poll. */
  supportsPolling?: boolean;

  /** Authenticate incoming request (JWT, HMAC, etc.) and check if processing should be skipped */
  authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    secret: string,
    sourceName: string
  ): Promise<AuthResult>;

  /** Optional: Preprocess payload (fetch additional data via API) */
  preprocess?(
    rawPayload: unknown,
    source?: ExternalSource,
    options?: IngestionOptions,
  ): Promise<unknown>;

  /** Optional: Dynamically determine source name for database lookup based on payload */
  getSourceNameFromDB?(payload: unknown): string | undefined;

  /** Optional: Check if the payload is a test payload and return response if it is */
  isTestPayload?(payload: unknown): TestPayloadResult;

  /** Optional: Handle webhook verification via query params (e.g., ?validationToken).
   *  Runs BEFORE source DB lookup — source may not exist yet during subscription setup. */
  isTestQueryParam?(query: Record<string, string | undefined>): TestPayloadResult;

  /** Transform platform-specific data to NormalizedData */
  transform(
    payload: unknown,
    source?: ExternalSource,
  ): Promise<ParseResult<NormalizedData | NormalizedData[]>>;

  /** Optional: Postprocess after conversation/message creation (e.g., create tickets, trigger workflows) */
  postprocess?(context: PostprocessContext): Promise<void>;

  /**
   * Optional: manual refetch handler. Implemented in the adapter's refetch.ts.
   * Present ⇒ adapter supports the /refetch endpoint. Absent ⇒ 400 "not supported".
   */
  refetch?(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult>;

  /**
   * Optional: outbound mail reply sender (e.g. Microsoft Graph, Gmail).
   * Present ⇒ this provider can send mail replies through the unified
   * email-service flow. Adapter encapsulates provider quirks (which
   * thread/message id to anchor on).
   */
  sendMailReply?(ctx: MailReplyContext): Promise<MailReplyResult>;

  /**
   * Optional: outbound new-email sender (no thread anchor).
   * Present ⇒ this provider can initiate brand-new email threads from xyne desk.
   */
  sendMailNew?(ctx: NewMailContext): Promise<MailReplyResult>;

  /** Optional: provider reply sender for non-email Desk interactions. */
  sendInteractionReply?(ctx: InteractionReplyContext): Promise<NormalizedData>;
}

import type { MailReplyContext, MailReplyResult, NewMailContext } from './baseMailReplySender';
import type { InteractionReplyContext } from './baseInteractionReplySender';
