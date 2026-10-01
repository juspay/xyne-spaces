import { Response } from 'express';
import {
  resolveSafeDownloadHeaders,
  resolveSafeInlineImageHeaders,
} from '@xyne/shared/utils';

// The header policy itself (allowlists, nosniff, octet-stream fallback) lives
// in @xyne/shared so xyne-claw-auth serves attachments with the exact same
// rules. These wrappers only apply it to an Express response.

interface SafeDownloadOptions {
  mimetype?: string | null;
  filename?: string | null;
}

function applyHeaders(res: Response, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
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
  applyHeaders(res, resolveSafeInlineImageHeaders(contentType));
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
  applyHeaders(res, resolveSafeDownloadHeaders({ mimetype, filename }));
}
