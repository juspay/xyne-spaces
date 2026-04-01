import type { DownloadedAttachment } from '@/services/externalAttachmentService';
import type { gmail_v1 } from 'googleapis';

export interface GoogleMailRawPayload {
  message: gmail_v1.Schema$Message;
  mailboxEmail: string;
  gmail: gmail_v1.Gmail;
}

export interface GoogleMailPreprocessedPayload {
  message: gmail_v1.Schema$Message;
  mailboxEmail: string;
  bodyHtml: string;
  bodyText: string;
  downloadedAttachments: DownloadedAttachment[];
}
