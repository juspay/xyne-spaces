import { Response } from 'express';

// MIME types that are safe to render inline in the browser.
// Everything else (text/html, image/svg+xml, xhtml, …) is forced to download
// so attacker-supplied markup cannot execute as active content in our origin
// (stored XSS). Client-supplied Content-Type is never echoed for these.
const SAFE_INLINE_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'application/pdf',
  'text/plain',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
]);

interface SafeDownloadOptions {
  mimetype?: string | null;
  filename?: string | null;
}

/**
 * Sets Content-Type / Content-Disposition on an attachment download response.
 *
 * Known-safe types (images, pdf, plain text, audio/video) keep their inline
 * disposition so existing previews keep working. Any other type is served as
 * an opaque `application/octet-stream` download. `X-Content-Type-Options:
 * nosniff` is always sent so the browser cannot re-interpret the body as HTML.
 */
export function setSafeDownloadHeaders(
  res: Response,
  { mimetype, filename }: SafeDownloadOptions,
): void {
  const normalized = (mimetype || '').split(';')[0].trim().toLowerCase();
  const isSafeInline = SAFE_INLINE_MIME_TYPES.has(normalized);
  const encodedFilename = encodeURIComponent(filename || 'download');

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (isSafeInline) {
    res.setHeader('Content-Type', normalized);
    res.setHeader('Content-Disposition', `inline; filename="${encodedFilename}"`);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"`);
  }
}
