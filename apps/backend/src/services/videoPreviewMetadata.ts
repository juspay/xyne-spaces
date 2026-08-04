import type { Prisma } from '@prisma/client';

export type VideoPreviewStatus = 'pending' | 'processing' | 'ready' | 'not_required' | 'failed';

export interface VideoPreviewMetadata {
  status: VideoPreviewStatus;
  codec?: string;
  previewUrl?: string;
  previewMimetype?: string;
  requestedAt?: string;
  completedAt?: string;
  error?: string;
}

type AttachmentMetadata = Record<string, unknown>;

export function shouldScheduleVideoPreview(
  mimetype: string,
  thumbnailUrl?: string | null,
  metadata?: unknown,
  workerEnabled = true
): boolean {
  const type = getAttachmentMetadata(metadata).type;
  const usesTranscriptionBucket =
    type === 'recording' || type === 'transcript' || type === 'identified_transcript';
  return (
    workerEnabled && mimetype.startsWith('video/') && !thumbnailUrl && !usesTranscriptionBucket
  );
}

export function isBrowserCompatibleVideoStream(
  mimetype: string,
  codec: string,
  pixelFormat: string | null
): boolean {
  return mimetype === 'video/mp4' && codec === 'h264' && pixelFormat === 'yuv420p';
}

export function getAttachmentMetadata(metadata: unknown): AttachmentMetadata {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return {};
  return metadata as AttachmentMetadata;
}

export function getVideoPreviewMetadata(metadata: unknown): VideoPreviewMetadata | null {
  const value = getAttachmentMetadata(metadata).videoPreview;
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;

  const preview = value as Record<string, unknown>;
  if (
    preview.status !== 'pending' &&
    preview.status !== 'processing' &&
    preview.status !== 'ready' &&
    preview.status !== 'not_required' &&
    preview.status !== 'failed'
  ) {
    return null;
  }

  return preview as unknown as VideoPreviewMetadata;
}

export function withVideoPreviewMetadata(
  metadata: unknown,
  videoPreview: VideoPreviewMetadata
): Prisma.InputJsonObject {
  const serializablePreview = Object.fromEntries(
    Object.entries(videoPreview).filter(([, value]) => value !== undefined)
  );
  return {
    ...getAttachmentMetadata(metadata),
    videoPreview: serializablePreview as Prisma.InputJsonObject,
  };
}

export function getVideoPlaybackSource(
  originalUrl: string,
  originalMimetype: string,
  originalFilename: string,
  metadata: unknown
): { url: string; mimetype: string; filename: string; isPreview: boolean } {
  const attachmentType = getAttachmentMetadata(metadata).type;
  const preview = getVideoPreviewMetadata(metadata);
  const usesTranscriptionBucket =
    attachmentType === 'recording' ||
    attachmentType === 'transcript' ||
    attachmentType === 'identified_transcript';
  if (!usesTranscriptionBucket && preview?.status === 'ready' && preview.previewUrl) {
    return {
      url: preview.previewUrl,
      mimetype: preview.previewMimetype || 'video/mp4',
      filename: `${originalFilename.replace(/\.[^.]+$/, '')}-preview.mp4`,
      isPreview: true,
    };
  }

  return {
    url: originalUrl,
    mimetype: originalMimetype,
    filename: originalFilename,
    isPreview: false,
  };
}
