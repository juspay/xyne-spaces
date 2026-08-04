import { DatabaseClient } from '@/database/client';
import { videoPreviewQueue } from '@/queues/videoPreviewQueue';
import { storageService } from '@/services/storage';
import {
  getVideoPreviewMetadata,
  withVideoPreviewMetadata,
  type VideoPreviewStatus,
} from '@/services/videoPreviewMetadata';
import { config } from '@/config/env';

const FAILED_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

const db = DatabaseClient.getInstance();

export async function scheduleVideoPreview(attachmentId: string): Promise<VideoPreviewStatus> {
  if (!config.enableVideoPreviewWorker) {
    throw new Error('Video preview worker is disabled');
  }
  const attachment = await db.messageAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.isDeleted) throw new Error('Attachment not found');
  if (!attachment.mimetype.startsWith('video/')) throw new Error('Attachment is not a video');
  const attachmentType = (attachment.metadata as { type?: string } | null)?.type;
  if (
    attachmentType === 'recording' ||
    attachmentType === 'transcript' ||
    attachmentType === 'identified_transcript'
  ) {
    return 'not_required';
  }

  const existing = getVideoPreviewMetadata(attachment.metadata);
  if (existing?.status === 'ready' && existing.previewUrl) {
    if (await storageService.fileExists(existing.previewUrl)) return 'ready';
  }
  if (existing?.status === 'pending' || existing?.status === 'processing') {
    return existing.status;
  }
  if (existing?.status === 'not_required') return 'not_required';
  if (existing?.status === 'failed' && existing.completedAt) {
    const failedAt = Date.parse(existing.completedAt);
    if (Number.isFinite(failedAt) && Date.now() - failedAt < FAILED_RETRY_COOLDOWN_MS) {
      return 'failed';
    }
  }

  const requestedAt = new Date().toISOString();
  await db.messageAttachment.update({
    where: { id: attachment.id },
    data: {
      metadata: withVideoPreviewMetadata(attachment.metadata, {
        status: 'pending',
        requestedAt,
      }),
    },
  });

  try {
    await videoPreviewQueue.enqueue(attachment.id);
    return 'pending';
  } catch (error) {
    const current = await db.messageAttachment.findUnique({ where: { id: attachment.id } });
    if (current) {
      await db.messageAttachment.update({
        where: { id: attachment.id },
        data: {
          metadata: withVideoPreviewMetadata(current.metadata, {
            status: 'failed',
            requestedAt,
            completedAt: new Date().toISOString(),
            error: 'Preview service is unavailable',
          }),
        },
      });
    }
    throw error;
  }
}
