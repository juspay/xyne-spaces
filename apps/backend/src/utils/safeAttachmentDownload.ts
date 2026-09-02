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

// Image types allowed to render inline from image-only endpoints (avatars,
// custom emojis). SVG is included but served with a script-blocking CSP below.
const INLINE_IMAGE_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
]);

interface SafeDownloadOptions {
  mimetype?: string | null;
  filename?: string | null;
}

/**
 * Sets response headers for an image-only streaming endpoint (avatars, custom
 * emojis) that are rendered via <img>. SVG stays renderable but is served with
 * a sandbox CSP so it cannot execute scripts on direct navigation. Any type
 * outside the image allowlist is downgraded to an opaque download. nosniff is
 * always sent.
 */
export function setSafeInlineImageHeaders(
  res: Response,
  contentType?: string | null,
): void {
  const normalized = (contentType || '').split(';')[0].trim().toLowerCase();
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!INLINE_IMAGE_MIME_TYPES.has(normalized)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    return;
  }

  if (normalized === 'image/svg+xml') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }
  res.setHeader('Content-Type', normalized);
}

const INLINE_VIDEO_MIME_TYPES = new Set<string>(['video/mp4', 'video/webm']);

/**
 * Sets response headers for a media endpoint rendered via <img> or <video>. Identical to
 * setSafeInlineImageHeaders for images; additionally keeps the two video container types
 * playable instead of downgrading them to an opaque download. SVG is excluded — a video
 * surface has no reason to serve markup.
 *
 * Returns whether the type was served inline, so callers can 415 rather than silently
 * handing back an attachment.
 */
export function setSafeInlineMediaHeaders(
  res: Response,
  contentType?: string | null,
): boolean {
  const normalized = (contentType || '').split(';')[0].trim().toLowerCase();
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const inlinable =
    INLINE_VIDEO_MIME_TYPES.has(normalized) ||
    (INLINE_IMAGE_MIME_TYPES.has(normalized) && normalized !== 'image/svg+xml');

  if (!inlinable) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    return false;
  }

  res.setHeader('Content-Type', normalized);
  return true;
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
