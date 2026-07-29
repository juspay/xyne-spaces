/** Google Pub/Sub push notification envelope */
export interface GooglePubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

/** Decoded base64 payload inside Pub/Sub message.data */
export interface GooglePubSubData {
  emailAddress: string;
  historyId: string;
}

/** Gmail API message resource (format: full) */
export interface GmailMessageData {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPayload;
  sizeEstimate?: number;
}

export interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayload[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

export interface GmailAttachment {
  attachmentId?: string;
  /** Pre-decoded bytes when Gmail inlined the part on `body.data`. */
  data?: Buffer;
  filename: string;
  mimeType: string;
  size: number;
  /**
   * MIME `Content-ID` header (without angle brackets) for inline images
   * referenced from the HTML body via `cid:<contentId>`. The renderer
   * rewrites those `cid:` URLs to authenticated blob URLs.
   */
  contentId?: string;
}

/** Structured email data extracted from GmailMessageData */
export interface ParsedEmailData {
  messageId: string;
  threadId: string;
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  date?: string;
  body?: string;
  htmlBody?: string;
  textBody?: string;
  attachments?: GmailAttachment[];
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** OAuth credentials stored encrypted in ExternalSource.credentials */
export interface GoogleCredentials {
  accessToken: string;
  refreshToken: string;
  email: string;
}
