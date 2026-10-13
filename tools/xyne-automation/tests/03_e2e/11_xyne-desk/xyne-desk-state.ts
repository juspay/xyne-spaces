import type { APIRequestContext } from '@playwright/test';
import { config } from '@/config';

export interface MockDeskMailFixture {
  alias: string;
  subject: string;
  body: string;
  from: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  attachments?: MockDeskAttachmentFixture[];
  threadId: string;
  messageId: string;
  channelAlias?: string;
  conversationId?: string;
  // Set for mails sent through the Desk composer UI: the visible text typed.
  // The composer decorates the stored HTML, so ingestion compares text only.
  composedText?: string;
  ticketId?: string;
  xyneId?: string;
}

interface MockDeskAttachmentFixture {
  filename: string;
  mimetype: string;
  size: number;
}

export interface SentMail {
  channelId?: unknown;
  conversationId?: unknown;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
  kind?: unknown;
  status?: unknown;
  attachmentCount?: unknown;
}

export interface DeskTicketDetails {
  ticket?: {
    id?: string;
    xyneId?: string;
    title?: string;
    description?: string;
    priority?: string;
    statusV2?: string;
    channelId?: string;
    isArchived?: boolean;
    mergedIntoTicketId?: string | null;
  };
  emails?: Array<{
    id?: string;
    subject?: string;
    body?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
  }>;
  attachments?: Array<{
    entityId?: string;
    originalFilename?: string;
    mimetype?: string;
    size?: number;
  }>;
}

export interface DeskChannelTicket {
  title?: string;
  conversationId?: string;
}

export interface MockDlMail {
  dlEmail?: unknown;
  subject?: unknown;
}

export interface ConnectedDeskSourceStatus {
  email?: string | null;
  isConnected?: boolean;
  hasSource?: boolean;
  sourceType?: string | null;
  connectedLabel?: string | null;
}

export interface PubSubBulkResult {
  published?: number;
  processed?: number;
  created?: number;
  duplicates?: number;
  skipped?: number;
}

export type PubSubMessage = Record<string, unknown>;

export interface PubSubBatch {
  messageIds: string[];
  historyId: string;
  failedAtIndex?: number;
}

export const DEFAULT_DESK_API_USER_ALIAS = 'admin-1';
export const DESK_UI_TIMEOUT_MS = config.timeout * 2;
// The bulk Pub/Sub route ingests messages through the real pipeline one by one;
// without Vespa/LLM in the Docker stack each one spends several seconds in
// timeouts, so the request budget scales with the batch size.
export const PUBSUB_PER_MESSAGE_TIMEOUT_MS = 15_000;

export const mockDeskMails = new Map<string, MockDeskMailFixture>();
export const deskChannelDlEmails = new Map<string, string>();
export const slackChannelIds = new Map<string, string>();
export const mockDlEmails = new Map<string, string>();
export const mockPubSubBatches = new Map<string, PubSubBatch>();
export const mockPubSubMessages = new Map<string, PubSubMessage[]>();
export const apiContextsByUserAlias = new Map<string, APIRequestContext>();

async function disposeDeskApiContexts(): Promise<void> {
  const contexts = [...apiContextsByUserAlias.values()];
  apiContextsByUserAlias.clear();

  await Promise.allSettled(contexts.map((apiContext) => apiContext.dispose()));
}

export async function resetDeskScenarioState(): Promise<void> {
  mockDeskMails.clear();
  deskChannelDlEmails.clear();
  slackChannelIds.clear();
  mockDlEmails.clear();
  mockPubSubBatches.clear();
  mockPubSubMessages.clear();
  await disposeDeskApiContexts();
}
