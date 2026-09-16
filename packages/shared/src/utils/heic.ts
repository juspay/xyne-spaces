/**
 * HEIC/HEIF attachment helpers shared by dashboard and backend.
 *
 * iPhones send HEIC photos, which most browsers cannot decode (Safari only).
 * The uploaded original stays byte-exact in storage; renderable WebP
 * renditions are derived from it (server-side for sent attachments,
 * client-side for the sender's draft preview).
 *
 * Detection runs against both the MIME type and the filename: browsers do not
 * always report a HEIC MIME type (Chrome on Linux reports
 * application/octet-stream), so the extension is a required fallback. Both
 * consumers of this predicate must agree on what counts as HEIC, which is why
 * it lives here rather than being duplicated per app.
 */

const HEIC_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

const HEIC_EXTENSIONS: readonly string[] = ['.heic', '.heif', '.hif'];

/**
 * Whether an attachment is a HEIC/HEIF image. MIME type first (parameters
 * like `; charset=` are stripped), then filename extension.
 */
export function isHeicAttachment(mimetype: string, fileName: string): boolean {
  const type = (mimetype || '').split(';')[0].trim().toLowerCase();
  if (HEIC_MIME_TYPES.has(type)) return true;

  const name = (fileName || '').toLowerCase();
  return HEIC_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** `IMG_4032.heic` → `IMG_4032.webp`; falls back to appending `.webp` when unnamed. */
export function toWebpFilename(fileName: string): string {
  const stem = (fileName || '').replace(/\.[^./\\]+$/, '');
  return `${stem || 'image'}.webp`;
}
