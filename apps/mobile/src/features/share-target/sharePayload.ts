import { resolveAttachmentMimeType } from '@/src/components/attachments-viewer/utils/file-viewer';

import type { IncomingSharePayload, IncomingSharedFile } from './nativeShareTarget';

export const isLocalFileUri = (value: string): boolean => value.trim().startsWith('file://');

export const fileNameFromUri = (uri: string): string => {
  const trimmed = uri.trim();
  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  const segment = withoutQuery.split('/').pop() ?? 'shared-file';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const fileFromUri = (uri: string): IncomingSharedFile => {
  const name = fileNameFromUri(uri);
  return {
    uri,
    name,
    type: resolveAttachmentMimeType(null, name),
    size: 0,
  };
};

/** Drop local file paths the share sheet sometimes copies into the text field. */
export const sanitizeShareText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .split('\n')
    .filter(line => !isLocalFileUri(line))
    .join('\n')
    .trim();
};

const recoverFilesFromText = (text: string | null | undefined): IncomingSharedFile[] => {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(isLocalFileUri)
    .map(fileFromUri);
};

/**
 * iOS Files share can surface a PDF as `text: file://...` with an empty `files`
 * array. Recover those URIs into attachments before upload/send.
 */
export const normalizeIncomingSharePayload = (
  payload: IncomingSharePayload,
): IncomingSharePayload => {
  const sanitizedText = sanitizeShareText(payload.text);
  const files = payload.files.length > 0 ? payload.files : recoverFilesFromText(payload.text);

  return { ...payload, text: sanitizedText, files };
};
