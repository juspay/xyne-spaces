/**
 * Chat attachments are soft-deleted (`isDeleted: true`) and remain in Zero.
 * Chat UI should ignore those rows for media; when every attachment is deleted,
 * show the "This file was deleted." placeholder.
 */
export const DELETED_ATTACHMENT_PLACEHOLDER = 'This file was deleted.';

export const isActiveAttachment = <T extends { isDeleted?: boolean | null }>(
  attachment: T,
): boolean => attachment.isDeleted !== true;

export const activeAttachmentsOf = <T extends { isDeleted?: boolean | null }>(
  attachments: readonly T[] | null | undefined,
): T[] => (attachments ?? []).filter(isActiveAttachment);

export const hasSoftDeletedAttachmentsOnly = <T extends { isDeleted?: boolean | null }>(
  attachments: readonly T[] | null | undefined,
): boolean => {
  const rows = attachments ?? [];
  return rows.length > 0 && rows.every(attachment => attachment.isDeleted === true);
};
