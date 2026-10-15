import { apiPost, isMtlsRequestError } from '@/src/services/apiClient';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';

import { stripHtml } from '../../utils/strip-html';
import type { MailboxRecipient } from './mailbox-reply.utils';

const CLAW_CITATION_TOKEN_RE = /([【[⟦])(clf-[A-Za-z0-9_.:-]+#\d+)([】\]⟧])/g;
const CLAW_CITATION_MALFORMED_RE = /[【[⟦]\s*clf-[^】\]⟧]*[】\]⟧]/g;
const INLINE_ATTACHMENT_ATTR_RE = /\bdata-att-id=["']([^"']+)["']/gi;
const INLINE_ATTACHMENT_DOWNLOAD_RE = /\/attachments\/([^/"'\s<>]+)\/download/gi;
const IMAGE_TAG_RE = /<img\b/i;

type ReplyType = 'REPLY' | 'REPLY_ALL';

export type SendMailboxReplyInput = {
  conversationId: string;
  subject?: string | null | undefined;
  bodyText: string;
  bodyHtml: string;
  to: readonly MailboxRecipient[];
  cc?: readonly MailboxRecipient[] | undefined;
  bcc?: readonly MailboxRecipient[] | undefined;
  replyToEmailId?: string | null | undefined;
  draftId?: string | null | undefined;
  attachmentIds?: readonly string[] | undefined;
  signatureHtml?: string | null | undefined;
  type?: ReplyType | undefined;
};

export type SendMailboxReplyResponse = {
  success: boolean;
  emailId?: string | undefined;
  threadId?: string | undefined;
  warning?: string | undefined;
  attachments?: Array<{
    id: string;
    url: string;
    originalFilename: string;
    size: number;
    mimetype: string;
  }>;
};

type MailboxReplyApiBody = {
  body: string;
  type: ReplyType;
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  replyToEmailId?: string;
  draftId?: string;
  attachmentIds?: string[];
};

export class MailboxReplySendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailboxReplySendValidationError';
  }
}

export async function sendMailboxReply(
  input: SendMailboxReplyInput,
): Promise<SendMailboxReplyResponse> {
  const body = buildMailboxReplyApiBody(input);

  return apiPost<SendMailboxReplyResponse>(
    `/email/${encodeURIComponent(input.conversationId)}/reply`,
    body,
  );
}

export type SendMailboxComposeInput = {
  channelId: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  to: readonly MailboxRecipient[];
  cc?: readonly MailboxRecipient[] | undefined;
  bcc?: readonly MailboxRecipient[] | undefined;
  attachmentIds?: readonly string[] | undefined;
  signatureHtml?: string | null | undefined;
};

export type SendMailboxComposeResponse = {
  success: boolean;
  sent?: boolean | undefined;
  ticketId?: string | undefined;
  ticketXyneId?: string | undefined;
  conversationId?: string | undefined;
  channelId?: string | undefined;
  emailId?: string | undefined;
  threadId?: string | undefined;
  warning?: string | undefined;
};

type MailboxComposeApiBody = {
  channelId: string;
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  bcc: string[];
  attachmentIds?: string[];
};

export async function sendMailboxCompose(
  input: SendMailboxComposeInput,
): Promise<SendMailboxComposeResponse> {
  return apiPost<SendMailboxComposeResponse>('/email/compose', buildMailboxComposeApiBody(input));
}

function buildMailboxComposeApiBody(input: SendMailboxComposeInput): MailboxComposeApiBody {
  const channelId = input.channelId.trim();
  if (!channelId) {
    throw new MailboxReplySendValidationError('Desk is still loading.');
  }

  const to = recipientsToEmails(input.to);
  if (to.length === 0) {
    throw new MailboxReplySendValidationError('Add at least one recipient.');
  }

  const subject = input.subject.trim();
  if (!subject) {
    throw new MailboxReplySendValidationError('Add a subject before sending.');
  }

  const bodyContent = composeBodyHtml(input);
  const attachmentIds = collectAttachmentIds(input.attachmentIds ?? [], bodyContent);
  if (!hasMeaningfulBody(bodyContent) && attachmentIds.length === 0) {
    throw new MailboxReplySendValidationError('Write a message before sending.');
  }

  return {
    channelId,
    subject,
    body: appendUniqueToken(bodyContent),
    to,
    cc: recipientsToEmails(input.cc ?? []),
    bcc: recipientsToEmails(input.bcc ?? []),
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  };
}

export function getMailboxReplySendErrorMessage(error: unknown): string {
  if (error instanceof MailboxReplySendValidationError) return error.message;

  const parsed = parseApiErrorBody(error);
  if (parsed?.error === 'email_reply_disabled') {
    return parsed.message || 'Email sending is temporarily disabled for this ticket.';
  }
  if (parsed?.error === 'attachment_upload_failed') {
    return parsed.message || 'One or more attachments could not be sent.';
  }
  if (parsed?.message) return parsed.message;
  if (parsed?.error) return parsed.error;

  if (isMtlsRequestError(error)) {
    if (error.statusCode === 400) return 'Unable to send reply. Please check recipients and body.';
    if (error.statusCode === 401) return 'You need to sign in again before sending this reply.';
    if (error.statusCode === 403) return 'You do not have access to send replies in this desk.';
    if (error.statusCode === 404) return 'This email thread is no longer available.';
    if (error.statusCode === 422) return 'One or more attachments could not be sent.';
    if (error.statusCode >= 500) return 'Could not send this email. Please try again.';
  }

  return error instanceof Error ? error.message : 'Failed to send reply.';
}

function buildMailboxReplyApiBody(input: SendMailboxReplyInput): MailboxReplyApiBody {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new MailboxReplySendValidationError('Reply details are still loading.');
  }

  const to = recipientsToEmails(input.to);
  const cc = recipientsToEmails(input.cc ?? []);
  const bcc = recipientsToEmails(input.bcc ?? []);

  if (to.length === 0) {
    throw new MailboxReplySendValidationError('Add at least one recipient.');
  }

  const bodyContent = composeBodyHtml(input);
  const attachmentIds = collectAttachmentIds(input.attachmentIds ?? [], bodyContent);
  const hasBodyContent = hasMeaningfulBody(bodyContent);

  if (!hasBodyContent && attachmentIds.length === 0) {
    throw new MailboxReplySendValidationError('Write a reply before sending.');
  }

  const finalBody = appendUniqueToken(bodyContent);
  const subject = normalizeOptionalString(input.subject);
  const replyToEmailId = normalizeOptionalString(input.replyToEmailId);
  const draftId = normalizeOptionalString(input.draftId);

  return {
    body: finalBody,
    type: input.type ?? 'REPLY_ALL',
    to,
    cc,
    bcc,
    ...(subject ? { subject } : {}),
    ...(replyToEmailId ? { replyToEmailId } : {}),
    ...(draftId ? { draftId } : {}),
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  };
}

function composeBodyHtml(input: {
  bodyText: string;
  bodyHtml: string;
  signatureHtml?: string | null | undefined;
}): string {
  const bodyHtml = normalizeBodyHtml(input.bodyHtml, input.bodyText);
  const bodyWithoutCitations = stripCitationMarks(bodyHtml);
  const signatureHtml = normalizeOptionalString(input.signatureHtml);

  if (!signatureHtml) return bodyWithoutCitations;
  return `${bodyWithoutCitations}${bodyWithoutCitations ? '<br>' : ''}${signatureHtml}`;
}

function normalizeBodyHtml(bodyHtml: string, bodyText: string): string {
  return buildComposerContentForSend(bodyText, bodyHtml) ?? '';
}

function hasMeaningfulBody(html: string): boolean {
  if (!html.trim()) return false;
  if (IMAGE_TAG_RE.test(html)) return true;
  return stripHtml(html).trim().length > 0;
}

function recipientsToEmails(recipients: readonly MailboxRecipient[]): string[] {
  return uniqueStrings(
    recipients
      .map(recipient => recipient.email.trim().toLowerCase())
      .filter(email => email.length > 0),
  );
}

function collectAttachmentIds(explicitIds: readonly string[], bodyHtml: string): string[] {
  const ids: string[] = [...explicitIds];

  for (const match of bodyHtml.matchAll(INLINE_ATTACHMENT_ATTR_RE)) {
    if (match[1]) ids.push(match[1]);
  }

  for (const match of bodyHtml.matchAll(INLINE_ATTACHMENT_DOWNLOAD_RE)) {
    if (match[1]) ids.push(match[1]);
  }

  return uniqueStrings(ids.map(id => id.trim()).filter(Boolean));
}

function appendUniqueToken(html: string): string {
  const token =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${html}<span style="font-size:1px;color:transparent;display:inline-block;line-height:0;">${token}</span>`;
}

function stripCitationMarks(html: string): string {
  return html
    .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, '$1')
    .replace(/\n?<citation\b[^>]*>([\s\S]*?)<\/citation>/gi, '')
    .replace(CLAW_CITATION_TOKEN_RE, '')
    .replace(CLAW_CITATION_MALFORMED_RE, '');
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
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
