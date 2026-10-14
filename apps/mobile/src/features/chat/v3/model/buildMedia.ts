import {
  ATTACHMENT_GRID_HEIGHT,
  FILE_ATTACHMENT_CARD_HEIGHT,
} from '@/src/components/conversation-composer/attachment-layout';

import type { MediaItem, MediaPreview } from './chatRow.types';
import type { AttachmentInput } from './conversationInput';
import { attachmentMediaKindFor } from './attachmentKind';

export const DEFAULT_MEDIA_ASPECT_RATIO = 4 / 3;
/** Grid height plus the shared grid's vertical margins (`mt-1.5 mb-1`). */
export const MEDIA_GRID_HEIGHT_PX = ATTACHMENT_GRID_HEIGHT + 10;
/** The shared grid's `gap-1` between file cards. */
export const FILE_ATTACHMENT_LIST_GAP_PX = 4;
/** The shared grid's `mt-1.5` between media and the file-card list. */
export const MEDIA_FILE_SECTION_GAP_PX = 6;
/** File card plus the shared grid's vertical margins (`mt-1.5 mb-1`). */
export const FILE_ATTACHMENT_HEIGHT_PX = FILE_ATTACHMENT_CARD_HEIGHT + 10;

const kindFromAttachment = (attachment: AttachmentInput): 'image' | 'video' | 'file' =>
  attachmentMediaKindFor(attachment.mimetype, attachment.originalFilename) ?? 'file';

const itemFrom = (attachment: AttachmentInput): MediaItem => ({
  id: attachment.id,
  mimetype: attachment.mimetype,
  ...(attachment.originalFilename ? { originalFilename: attachment.originalFilename } : {}),
  ...(typeof attachment.size === 'number' ? { size: attachment.size } : {}),
  ...(typeof attachment.durationSeconds === 'number'
    ? { durationSeconds: attachment.durationSeconds }
    : {}),
});

export const buildMedia = (attachments: readonly AttachmentInput[]): MediaPreview | null => {
  if (attachments.length === 0) return null;
  const kinds = new Set(attachments.map(kindFromAttachment));
  const kind: MediaPreview['kind'] = kinds.size > 1 ? 'mixed' : (Array.from(kinds)[0] ?? 'file');
  const first = attachments[0];
  const firstMedia = attachments.find(item => kindFromAttachment(item) !== 'file') ?? first;
  const aspectRatio =
    firstMedia && firstMedia.width && firstMedia.height && firstMedia.height > 0
      ? firstMedia.width / firstMedia.height
      : DEFAULT_MEDIA_ASPECT_RATIO;
  const previewKind =
    firstMedia && kindFromAttachment(firstMedia) === 'image'
      ? 'image'
      : firstMedia && kindFromAttachment(firstMedia) === 'video'
        ? 'video'
        : null;
  const fileCount = attachments.filter(item => kindFromAttachment(item) === 'file').length;
  const hasMedia = kind !== 'file';
  const fileListHeight =
    fileCount * FILE_ATTACHMENT_CARD_HEIGHT +
    Math.max(0, fileCount - 1) * FILE_ATTACHMENT_LIST_GAP_PX;
  const reservedHeightPx = hasMedia
    ? MEDIA_GRID_HEIGHT_PX + (fileCount > 0 ? MEDIA_FILE_SECTION_GAP_PX + fileListHeight : 0)
    : 10 + fileListHeight;
  return {
    attachmentId: firstMedia?.id ?? first?.id ?? null,
    kind,
    mime: first?.mimetype ?? null,
    filename: first?.originalFilename ?? null,
    reservedHeightPx,
    aspectRatio,
    cachedThumbUri: firstMedia?.thumbUri ?? null,
    durationSeconds: firstMedia?.durationSeconds ?? null,
    attachmentCount: attachments.length,
    previewAttachmentKind: previewKind,
    items: attachments.map(itemFrom),
  };
};
