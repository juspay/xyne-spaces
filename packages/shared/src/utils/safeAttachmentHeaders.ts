// Framework-agnostic response-header policy for serving user/agent-uploaded
// files. Shared by the Spaces backend and xyne-claw-auth so both origins apply
// the same allowlist (XYNE-65486, findings C-1/C-9).
//
// Rule: the client-supplied Content-Type is NEVER echoed unless it is on a
// known-safe allowlist. Everything else (text/html, image/svg+xml, xhtml, xml,
// unknown types, …) is served as an opaque `application/octet-stream`
// download, and `X-Content-Type-Options: nosniff` is always sent so the
// browser cannot re-interpret the body as active content in our origin.

// MIME types that are safe to render inline in the browser.
export const SAFE_INLINE_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set<string>([
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
// custom emojis). SVG is included but served with a script-blocking CSP.
export const INLINE_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set<string>([
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

// CSP for SVG rendered from our origin: no scripts, no sub-resources, unique
// opaque origin (sandbox without allow-same-origin / allow-scripts).
export const SVG_SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export type SafeResponseHeaders = Record<string, string>;

export interface SafeDownloadHeaderOptions {
  mimetype?: string | null | undefined;
  filename?: string | null | undefined;
  /**
   * Render `image/svg+xml` inline under {@link SVG_SANDBOX_CSP} instead of
   * forcing a download. Only for endpoints whose SVGs are shown via `<img>`.
   */
  allowSandboxedSvg?: boolean | undefined;
}

/** Lower-cases a Content-Type and strips parameters (`; charset=…`). */
export function normalizeMimeType(mimetype?: string | null): string {
  return (mimetype || '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Headers for an attachment download/stream response.
 *
 * Known-safe types (images, pdf, plain text, audio/video) keep their inline
 * disposition so previews keep working. Any other type is served as an opaque
 * `application/octet-stream` attachment.
 */
export function resolveSafeDownloadHeaders({
  mimetype,
  filename,
  allowSandboxedSvg = false,
}: SafeDownloadHeaderOptions): SafeResponseHeaders {
  const normalized = normalizeMimeType(mimetype);
  const encodedFilename = encodeURIComponent(filename || 'download');
  const headers: SafeResponseHeaders = { 'X-Content-Type-Options': 'nosniff' };

  if (SAFE_INLINE_ATTACHMENT_MIME_TYPES.has(normalized)) {
    headers['Content-Type'] = normalized;
    headers['Content-Disposition'] = `inline; filename="${encodedFilename}"`;
  } else if (allowSandboxedSvg && normalized === 'image/svg+xml') {
    headers['Content-Type'] = normalized;
    headers['Content-Disposition'] = `inline; filename="${encodedFilename}"`;
    headers['Content-Security-Policy'] = SVG_SANDBOX_CSP;
  } else {
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Disposition'] = `attachment; filename="${encodedFilename}"`;
  }
  return headers;
}

/**
 * Headers for an image-only endpoint rendered via `<img>` (avatars, custom
 * emojis, thumbnails). SVG stays renderable under a sandbox CSP; any type
 * outside the image allowlist is downgraded to an opaque download.
 */
export function resolveSafeInlineImageHeaders(contentType?: string | null): SafeResponseHeaders {
  const normalized = normalizeMimeType(contentType);
  const headers: SafeResponseHeaders = { 'X-Content-Type-Options': 'nosniff' };

  if (!INLINE_IMAGE_MIME_TYPES.has(normalized)) {
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Disposition'] = 'attachment';
    return headers;
  }
  if (normalized === 'image/svg+xml') {
    headers['Content-Security-Policy'] = SVG_SANDBOX_CSP;
  }
  headers['Content-Type'] = normalized;
  return headers;
}
