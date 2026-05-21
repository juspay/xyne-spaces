/**
 * Microsoft Graph attachment pre-fetch.
 *
 * `GET /me/messages/{id}/attachments` returns each attachment with its bytes
 * inline as base64 `contentBytes`. We collect them and pipe through
 * `ExternalAttachmentService.downloadAttachmentsForSource` (with `buffer` set
 * on each ExternalAttachment) so the validate + GCS upload pipeline is the
 * same one Slack/Zoho URL fetches use.
 */

import { config } from '@/config/env';
import {
  ExternalAttachmentService,
  ExternalAttachment,
  DownloadedAttachment,
} from '@/services/externalAttachmentService';
import { logger } from '@/utils/logger';
import { graphFetchWithRetry } from './graphFetch';

interface GraphAttachment {
  id: string;
  name: string;
  contentType?: string;
  isInline?: boolean;
  contentId?: string;
  contentBytes?: string;
  '@odata.type'?: string;
}

export async function preDownloadGraphAttachments(params: {
  accessToken: string;
  graphMessageId: string;
  sourceName: string;
}): Promise<DownloadedAttachment[]> {
  const { accessToken, graphMessageId, sourceName } = params;

  let parts: GraphAttachment[];
  try {
    const res = await graphFetchWithRetry(
      `${config.microsoftGraph.baseUrl}/me/messages/${graphMessageId}/attachments?$top=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      logger.warn(`[MicrosoftAttachments] list failed for ${graphMessageId}: ${res.status}`);
      return [];
    }
    const body = (await res.json()) as { value: GraphAttachment[] };
    parts = body.value ?? [];
  } catch (err) {
    logger.warn(
      `[MicrosoftAttachments] list errored for ${graphMessageId}: ${err instanceof Error ? err.message : 'unknown'}`,
    );
    return [];
  }

  const attachments: ExternalAttachment[] = parts
    .filter(att => !att['@odata.type'] || att['@odata.type'].includes('fileAttachment'))
    .filter(att => !!att.contentBytes)
    .map(att => ({
      fileName: att.name || `attachment-${att.id}`,
      buffer: Buffer.from(att.contentBytes!, 'base64'),
      mimeType: att.contentType || 'application/octet-stream',
      ...(att.contentId && { contentId: att.contentId.replace(/^<|>$/g, '').trim() }),
      metadata: {
        graphAttachmentId: att.id,
        ...(att.isInline !== undefined && { isInline: att.isInline }),
      },
    }));

  if (attachments.length === 0) return [];
  return new ExternalAttachmentService().downloadAttachmentsForSource(sourceName, attachments);
}
