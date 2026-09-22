/**
 * Gmail attachment pre-fetch.
 *
 * `parseEmailData().attachments` returns a unified list — entries with
 * `attachmentId` need a Gmail API call to get bytes, entries with `data`
 * already have the bytes inline (small `cid:` images). We resolve every
 * entry to a buffer, then hand the lot to the existing
 * `downloadAttachmentsForSource` for the validate + GCS upload pipeline.
 */

import { GoogleService, getHttpStatus, isRetryableGmailError } from '@/services/googleService';
import {
  ExternalAttachmentService,
  ExternalAttachment,
  DownloadedAttachment,
} from '@/services/externalAttachmentService';
import { logger } from '@/utils/logger';

function base64UrlToBuffer(data: string): Buffer {
  return Buffer.from(data, 'base64url');
}

const ATTACHMENT_CONCURRENCY = 3;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]!) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function preDownloadGmailAttachments(params: {
  googleService: GoogleService;
  messageId: string;
  messageData: Parameters<GoogleService['parseEmailData']>[0];
  sourceName: string;
}): Promise<DownloadedAttachment[]> {
  const { googleService, messageId, messageData, sourceName } = params;

  const parts = googleService.parseEmailData(messageData).attachments ?? [];

  const results = await mapWithLimit(
    parts,
    ATTACHMENT_CONCURRENCY,
    async (att): Promise<ExternalAttachment | null> => {
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
    },
  );

  const stillThrottled = results.find(
    r => r.status === 'rejected' && isRetryableGmailError(r.reason),
  );
  if (stillThrottled?.status === 'rejected') {
    throw stillThrottled.reason;
  }

  const attachments = results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value ? [r.value] : [];
    logger.warn(
      `[GoogleAttachments] ${parts[i]?.filename} unavailable (status ${getHttpStatus(r.reason) ?? 'unknown'}) — ingesting without it`,
    );
    return [];
  });

  if (attachments.length === 0) return [];
  return new ExternalAttachmentService().downloadAttachmentsForSource(sourceName, attachments);
}
