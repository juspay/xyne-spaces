import type { PartialBlock } from '@blocknote/core';

/**
 * Beyond this the editor stops persisting the document, so anything written into it — an edit,
 * a comment anchor — would be lost on the next load. Shared by everything that writes to a
 * canvas so they all agree on the same ceiling.
 */
export const CONTENT_SIZE_MAX_THRESHOLD = 100 * 1024; // 100KB - block save

/** Size of the serialized document in bytes. */
export const getContentSizeBytes = (blocks: PartialBlock[]): number => {
  try {
    return new Blob([JSON.stringify(blocks)]).size;
  } catch {
    // Fallback to approximate size
    return JSON.stringify(blocks).length * 2; // UTF-16 approximate
  }
};

/** Format bytes to human readable */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/** The message shown wherever a write is refused because the document is already too large. */
export const CONTENT_SIZE_EXCEEDED_DESCRIPTION = (sizeBytes: number): string =>
  `Canvas content (${formatBytes(sizeBytes)}) exceeds the maximum size of ${formatBytes(
    CONTENT_SIZE_MAX_THRESHOLD,
  )}. Please reduce content size or use new canvas for better performance.`;
