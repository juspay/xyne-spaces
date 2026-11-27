import { isHeicAttachment } from '@xyne/shared';

/**
 * The lowercase extension of a file name, without the dot ("Report.PDF" → "pdf"); null when
 * the name has none. A leading dot alone (".env") is a name, not an extension.
 */
export function extractFileExtension(fileName: string): string | null {
  const base = fileName.trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Whether a file name is a HEIC/HEIF image by its extension, the same rule the dashboard and
 * the backend use (utils/heic.ts). The MIME type is not part of the encrypted name; a caller
 * that has it can still check it in plaintext.
 */
export function extractIsHeic(fileName: string): boolean {
  return isHeicAttachment('', fileName);
}
