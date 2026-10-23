import { DANGEROUS_EXTENSIONS } from '@xyne/shared';

/**
 * Client-side attachment limits shared by every composer entry point.
 *
 * The server remains authoritative, while this policy keeps picker, paste,
 * and share-target paths aligned before upload.
 */
export const MAX_COMPOSER_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

const getFileExtension = (filename: string): string => {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase();
};

export const getAttachmentRejectionReason = ({
  originalFilename,
  size,
}: {
  originalFilename: string;
  size: number;
}): string | null => {
  const extension = getFileExtension(originalFilename);
  if (DANGEROUS_EXTENSIONS.some(blocked => blocked.toLowerCase() === extension)) {
    return `File type '${extension}' is not allowed for security reasons`;
  }
  if (size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
    return 'File size exceeds 1 GB';
  }
  return null;
};

export const getAttachmentCountLimitError = (): string =>
  `You can attach at most ${MAX_COMPOSER_ATTACHMENT_COUNT} files at a time.`;

export const assertAttachmentCountWithinLimit = (
  existingCount: number,
  incomingCount: number,
): void => {
  if (
    !Number.isInteger(existingCount) ||
    existingCount < 0 ||
    !Number.isInteger(incomingCount) ||
    incomingCount < 0 ||
    existingCount + incomingCount > MAX_COMPOSER_ATTACHMENT_COUNT
  ) {
    throw new Error(getAttachmentCountLimitError());
  }
};

export const getRemainingAttachmentSlots = (existingCount: number): number => {
  if (!Number.isInteger(existingCount) || existingCount < 0) return 0;
  return Math.max(0, MAX_COMPOSER_ATTACHMENT_COUNT - existingCount);
};
