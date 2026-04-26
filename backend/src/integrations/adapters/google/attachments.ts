/**
 * Gmail attachment pre-fetch.
 *
 * `parseEmailData().attachments` returns a unified list — entries with
 * `attachmentId` need a Gmail API call to get bytes, entries with `data`
 * already have the bytes inline (small `cid:` images). We resolve every
 * entry to a buffer, then hand the lot to the existing
 * `downloadAttachmentsForSource` for the validate + GCS upload pipeline.
 */

import { GoogleService } from '@/services/googleService';
import {
  ExternalAttachmentService,
  ExternalAttachment,
  DownloadedAttachment,
} from '@/services/externalAttachmentService';
import { logger } from '@/utils/logger';

function base64UrlToBuffer(data: string): Buffer {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

export async function preDownloadGmailAttachments(params: {
  googleService: GoogleService;
  messageId: string;
  messageData: Parameters<GoogleService['parseEmailData']>[0];
  sourceName: string;
}): Promise<DownloadedAttachment[]> {
  const { googleService, messageId, messageData, sourceName } = params;

  const parts = googleService.parseEmailData(messageData).attachments ?? [];

  const results = await Promise.allSettled(
    parts.map(async (att): Promise<ExternalAttachment | null> => {
      // Inline part — bytes already on the payload.
      if (att.data) {
        return {
          fileName: att.filename,
          buffer: att.data,
          mimeType: att.mimeType,
          ...(att.contentId && { contentId: att.contentId }),
          metadata: { isInline: true },
        };
      }
      // attachmentId part — one Gmail API call per attachment.
      if (att.attachmentId) {
        const base64url = await googleService.getAttachment(messageId, att.attachmentId);
        if (!base64url) return null;
        return {
          fileName: att.filename,
          buffer: base64UrlToBuffer(base64url),
          mimeType: att.mimeType,
          ...(att.contentId && { contentId: att.contentId }),
          metadata: { gmailAttachmentId: att.attachmentId },
        };
      }
      return null;
    }),
  );

  const attachments = results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value ? [r.value] : [];
    logger.warn(
      `[GoogleAttachments] fetch failed for ${parts[i]?.filename}: ${r.reason instanceof Error ? r.reason.message : 'unknown'}`,
    );
    return [];
  });

  if (attachments.length === 0) return [];
  return new ExternalAttachmentService().downloadAttachmentsForSource(sourceName, attachments);
}
