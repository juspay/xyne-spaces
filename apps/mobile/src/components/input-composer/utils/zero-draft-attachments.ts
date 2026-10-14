import type { ComposerAttachment } from '../input-composer.types';

export type ZeroDraftAttachment = {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width?: number | null;
  height?: number | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  isDeleted?: boolean | null;
};

export const zeroDraftAttachmentsToComposerAttachments = (
  rows: readonly ZeroDraftAttachment[] | null | undefined,
): ComposerAttachment[] =>
  (rows ?? [])
    .filter(row => !row.isDeleted)
    .map(row => ({
      attachmentId: row.id,
      originalFilename: row.originalFilename,
      mimetype: row.mimetype,
      size: row.size,
      ...(typeof row.width === 'number' && row.width > 0 ? { width: row.width } : {}),
      ...(typeof row.height === 'number' && row.height > 0 ? { height: row.height } : {}),
      localUri: '',
      source: 'file',
      status: 'uploaded',
    }));
