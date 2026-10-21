import { apiPost, isMtlsRequestError } from '@/src/services/apiClient';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';

import { getChatDeskReplyPath } from '../../utils/desk-channel-kind';

export type SendChatDeskReplyInput = {
  channelType: string;
  conversationId: string;
  bodyText: string;
  bodyHtml: string;
  attachmentIds?: readonly string[] | undefined;
};

export type SendChatDeskReplyResponse = {
  emailId?: string | undefined;
  slackTs?: string | undefined;
  threadId?: string | undefined;
  delivered?: boolean | undefined;
};

export class ChatDeskReplyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatDeskReplyValidationError';
  }
}

export async function sendChatDeskReply(
  input: SendChatDeskReplyInput,
): Promise<SendChatDeskReplyResponse> {
  const path = getChatDeskReplyPath(input.channelType, input.conversationId);
  if (!path) {
    throw new ChatDeskReplyValidationError('Unable to send reply. Missing ticket conversation.');
  }

  const body = buildComposerContentForSend(input.bodyText, input.bodyHtml) ?? '';
  const attachmentIds = uniqueStrings(
    (input.attachmentIds ?? []).map(id => id.trim()).filter(Boolean),
  );

  if (!body && attachmentIds.length === 0) {
    throw new ChatDeskReplyValidationError('Write a reply before sending.');
  }

  return apiPost<SendChatDeskReplyResponse>(path, {
    body,
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  });
}

export function getChatDeskReplyErrorMessage(error: unknown): string {
  if (error instanceof ChatDeskReplyValidationError) return error.message;

  const parsed = parseApiErrorBody(error);
  if (parsed?.message) return parsed.message;
  if (parsed?.error) return parsed.error;

  if (isMtlsRequestError(error)) {
    if (error.statusCode === 400)
      return 'Unable to send reply. Please check the message and try again.';
    if (error.statusCode === 401) return 'You need to sign in again before sending this reply.';
    if (error.statusCode === 403) return 'You do not have access to send replies in this desk.';
    if (error.statusCode === 404) return 'This thread is no longer available.';
    if (error.statusCode >= 500) return 'Could not send this reply. Please try again.';
  }

  return error instanceof Error ? error.message : 'Failed to send reply.';
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseApiErrorBody(error: unknown): { error?: string; message?: string } | null {
  if (!isMtlsRequestError(error) || !error.responseBody) return null;

  try {
    const parsed = JSON.parse(error.responseBody) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record['error'] === 'string' ? { error: record['error'] } : {}),
      ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    };
  } catch {
    return null;
  }
}
