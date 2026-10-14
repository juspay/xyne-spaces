import type { MessageAttachment } from '@prisma/client';
import { config } from '../config/env';
import { getStorageService, storageService } from './storage/index';

const TRANSCRIPTION_BUCKET_TYPES = new Set(['transcript', 'identified_transcript', 'recording']);

export const getAttachmentType = (attachment: Pick<MessageAttachment, 'metadata'>): string =>
  (attachment.metadata as { type?: string } | null)?.type ?? '';

/** Transcripts and call recordings live in the transcription bucket; every other file in the default one. */
export const getAttachmentStorage = (
  attachment: Pick<MessageAttachment, 'metadata'>
): typeof storageService =>
  TRANSCRIPTION_BUCKET_TYPES.has(getAttachmentType(attachment))
    ? getStorageService(config.gcs.transcriptionBucketName)
    : storageService;
