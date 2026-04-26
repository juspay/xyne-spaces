/**
 * Base contract for mail-provider reply senders. Each adapter that sends
 * outbound email replies (Microsoft Graph, Gmail) extends this. The adapter
 * encapsulates provider quirks (e.g. Graph uses the *latest* thread id, Gmail
 * uses the *initial* one) so callers stay provider-agnostic.
 */

export interface MailReplyContext {
  encryptedCredentials: string;
  sourceId: string;
  body: string;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  /** Thread id of the very first email in the conversation. */
  initialExternalThreadId: string;
  /** Thread id of the most recent email in the conversation. */
  latestExternalThreadId: string;
  /** External message id of the most recent email — used as In-Reply-To. */
  latestExternalMessageId: string;
  fileAttachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
}

export interface MailReplyResult {
  threadId: string;
  messageId?: string;
}

export class AttachmentUploadError extends Error {
  readonly failedAttachments: Array<{ name: string; reason: string }>;

  constructor(failedAttachments: Array<{ name: string; reason: string }>) {
    super(
      `Failed to upload ${failedAttachments.length} attachment(s): ${failedAttachments.map(f => f.name).join(', ')}`,
    );
    this.name = 'AttachmentUploadError';
    this.failedAttachments = failedAttachments;
  }
}

export abstract class BaseMailReplySender {
  abstract sendReply(ctx: MailReplyContext): Promise<MailReplyResult>;
}
