import { resolveSafeDownloadHeaders } from "@xyne/shared/utils";

/**
 * Response headers for serving a chat attachment from the claw-auth origin
 * (XYNE-65486 / C-9).
 *
 * `mimeType` is whatever the uploader's multipart part declared — it is
 * attacker-controlled and must never be echoed blindly. The shared Spaces
 * policy keeps known-safe types (raster images, pdf, plain text, audio/video)
 * inline and serves everything else (html, xhtml, xml, unknown, …) as an
 * opaque `application/octet-stream` attachment with `nosniff`.
 *
 * SVG is rendered inline (chat shows `image/*` attachments via `<img>`) but
 * under a `sandbox` CSP with no script/sub-resource access, so opening it
 * directly in a tab cannot run script on this origin.
 */
export function attachmentResponseHeaders(att: {
  mimeType: string | null | undefined;
  originalFilename: string | null | undefined;
}): Record<string, string> {
  return resolveSafeDownloadHeaders({
    mimetype: att.mimeType,
    filename: att.originalFilename,
    allowSandboxedSvg: true,
  });
}

/** Headers for the JPEG thumbnail endpoint — fixed type, never sniffed. */
export const THUMBNAIL_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "image/jpeg",
  "X-Content-Type-Options": "nosniff",
});
