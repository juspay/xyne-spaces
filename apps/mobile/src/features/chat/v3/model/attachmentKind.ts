import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';

export type AttachmentMediaKind = 'image' | 'video' | null;

/** One media classification rule for the row model and every media renderer. */
export const attachmentMediaKindFor = (
  mimetype: string | null | undefined,
  originalFilename: string | null | undefined,
): AttachmentMediaKind => getAttachmentMediaKind(mimetype, originalFilename);
