import { createReadStream } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseClient } from '@/database/client';
import { storageService } from '@/services/storage';
import { normalizeStoragePath } from '@/services/storage/pathUtils';
import {
  getVideoPreviewMetadata,
  isBrowserCompatibleVideoStream,
  withVideoPreviewMetadata,
  type VideoPreviewMetadata,
} from '@/services/videoPreviewMetadata';
import { generateVideoThumbnail, probeVideoStream, transcodeVideoToH264 } from '@/utils/ffmpeg';
import { logger } from '@/utils/logger';

class VideoPreviewService {
  private db = DatabaseClient.getInstance();

  async processAttachment(attachmentId: string): Promise<void> {
    const attachment = await this.db.messageAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.isDeleted) return;
    if (!attachment.mimetype.startsWith('video/')) {
      throw new Error(`Attachment ${attachmentId} is not a video`);
    }
    const attachmentType = (attachment.metadata as { type?: string } | null)?.type;
    if (
      attachmentType === 'recording' ||
      attachmentType === 'transcript' ||
      attachmentType === 'identified_transcript'
    ) {
      await this.updatePreviewMetadata(attachmentId, {
        status: 'not_required',
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      return;
    }

    const existing = getVideoPreviewMetadata(attachment.metadata);
    if (existing?.status === 'ready' && existing.previewUrl) {
      if (await storageService.fileExists(existing.previewUrl)) return;
    }

    await this.updatePreviewMetadata(attachmentId, {
      ...existing,
      status: 'processing',
      requestedAt: existing?.requestedAt || new Date().toISOString(),
      error: undefined,
    });

    const originalPath = normalizeStoragePath(attachment.url);
    if (!originalPath) throw new Error(`Attachment ${attachmentId} has no uploaded file`);

    const workDir = await mkdtemp(join(tmpdir(), `xyne-video-preview-${attachmentId}-`));
    const inputPath = join(workDir, 'original-video');
    const outputPath = join(workDir, 'preview.mp4');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    const uploadedPaths: string[] = [];
    let persisted = false;
    try {
      await storageService.downloadFile(originalPath, inputPath);
      const streamInfo = await probeVideoStream(inputPath);

      if (!streamInfo)
        throw new Error(`Attachment ${attachmentId} does not contain a video stream`);
      const { codec, pixelFormat } = streamInfo;
      const originalIsBrowserCompatible = isBrowserCompatibleVideoStream(
        attachment.mimetype,
        codec,
        pixelFormat
      );

      let previewUrl: string | undefined;
      if (!originalIsBrowserCompatible) {
        await transcodeVideoToH264(inputPath, outputPath);
        const previewUpload = await storageService.uploadStream(createReadStream(outputPath), {
          filename: `${attachmentId}-preview.mp4`,
          contentType: 'video/mp4',
          scopeType: 'video-previews',
          scopeId: attachment.workspaceId,
          metadata: {
            sourceAttachmentId: attachmentId,
            sourceCodec: codec,
          },
        });
        previewUrl = previewUpload.path;
        uploadedPaths.push(previewUpload.path);
      }

      let thumbnailUrl = attachment.thumbnailUrl;
      try {
        await generateVideoThumbnail(
          originalIsBrowserCompatible ? inputPath : outputPath,
          thumbnailPath
        );
        const thumbnail = await readFile(thumbnailPath);
        const thumbnailUpload = await storageService.uploadFile(thumbnail, {
          filename: `${attachmentId}-preview.jpg`,
          contentType: 'image/jpeg',
          scopeType: 'video-preview-thumbnails',
          scopeId: attachment.workspaceId,
          metadata: { sourceAttachmentId: attachmentId },
        });
        thumbnailUrl = thumbnailUpload.path;
        uploadedPaths.push(thumbnailUpload.path);
      } catch (error) {
        logger.warn(`[VIDEO-PREVIEW] Thumbnail generation failed for ${attachmentId}`, error);
      }

      const current = await this.db.messageAttachment.findUnique({ where: { id: attachmentId } });
      if (!current || current.isDeleted) {
        return;
      }

      const ready: VideoPreviewMetadata = {
        status: originalIsBrowserCompatible ? 'not_required' : 'ready',
        codec,
        ...(previewUrl ? { previewUrl, previewMimetype: 'video/mp4' } : {}),
        requestedAt: existing?.requestedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      await this.db.messageAttachment.update({
        where: { id: attachmentId },
        data: {
          metadata: withVideoPreviewMetadata(current.metadata, ready),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        },
      });
      persisted = true;
      logger.info(`[VIDEO-PREVIEW] Compatibility processing complete for ${attachmentId}`, {
        sourceCodec: codec,
        sourcePixelFormat: pixelFormat,
        transcoded: !originalIsBrowserCompatible,
      });
    } finally {
      if (!persisted) {
        await Promise.allSettled(uploadedPaths.map((path) => storageService.deleteFile(path)));
      }
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async markFailed(attachmentId: string, error: unknown): Promise<void> {
    const attachment = await this.db.messageAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) return;
    const existing = getVideoPreviewMetadata(attachment.metadata);
    await this.updatePreviewMetadata(attachmentId, {
      ...existing,
      status: 'failed',
      requestedAt: existing?.requestedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message.slice(0, 500) : 'Preview generation failed',
    });
  }

  private async updatePreviewMetadata(
    attachmentId: string,
    preview: VideoPreviewMetadata
  ): Promise<void> {
    const attachment = await this.db.messageAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) return;
    await this.db.messageAttachment.update({
      where: { id: attachmentId },
      data: { metadata: withVideoPreviewMetadata(attachment.metadata, preview) },
    });
  }
}

export const videoPreviewService = new VideoPreviewService();
