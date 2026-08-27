import type { APIRequestContext } from '@playwright/test';

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
  ticketId?: string;
  xyneId?: string;
}

export interface MockDeskAttachmentFixture {
  filename: string;
  mimetype: string;
  size: number;
}

export const mockDeskMails = new Map<string, MockDeskMailFixture>();
export const deskChannelDlEmails = new Map<string, string>();
export const slackChannelIds = new Map<string, string>();
export const mockDlEmails = new Map<string, string>();
export const mockPubSubBatches = new Map<string, { messageIds: string[]; historyId: string }>();
export const mockPubSubMessages = new Map<string, Array<Record<string, unknown>>>();
export const apiContextsByUserAlias = new Map<string, APIRequestContext>();

export async function disposeDeskApiContexts(): Promise<void> {
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
