import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Calculate MD5 checksum of a buffer.
 */
export function calculateChecksum(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Detect MIME type using file-type (magic bytes), falling back to the
 * browser-provided MIME and then to 'application/octet-stream'.
 */
export async function detectMimeType(
  filename: string,
  buffer: Buffer,
  browserMime?: string,
): Promise<string> {
  try {
    const result = await fileTypeFromBuffer(buffer);
    if (result?.mime) {
      return result.mime;
    }
  } catch {
    // ignore detection errors
  }

  if (browserMime && browserMime !== 'application/octet-stream') {
    return browserMime;
  }

  // Derive from extension as a last resort
  const ext = filename.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  return (ext && extMap[ext]) ?? 'application/octet-stream';
}

/**
 * Generate a unique filename by appending (1), (2), … until the name is not
 * present in `existingNames`.
 */
export function generateUniqueName(filename: string, existingNames: string[]): string {
  const existing = new Set(existingNames);
  if (!existing.has(filename)) {
    return filename;
  }

  const lastDot = filename.lastIndexOf('.');
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot !== -1 ? filename.slice(lastDot) : '';

  let counter = 1;
  let candidate = `${base} (${counter})${ext}`;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }

  return candidate;
}

/**
 * Throw if the file exceeds the allowed size.
 */
export function checkFileSize(fileSizeBytes: number, maxSizeMb: number): void {
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (fileSizeBytes > maxBytes) {
    throw new Error(
      `File size ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB exceeds the maximum allowed size of ${maxSizeMb} MB`,
    );
  }
}
