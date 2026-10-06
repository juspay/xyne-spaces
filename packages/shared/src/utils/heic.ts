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
 * it lives here rather than being duplicated per app. When the actual bytes
 * are available, isHeicBuffer is the authority — a renamed .jpg can carry
 * HEIC bytes that neither the MIME type nor the name reveals.
 */

const HEIC_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

const HEIC_EXTENSIONS: readonly string[] = ['.heic', '.heif', '.hif'];

const HEIC_FTYP_BRANDS: readonly string[] = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];

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

/**
 * Byte-level HEIC/HEIF check: the first ISO-BMFF box must be an `ftyp` box
 * whose *major* brand is a HEIC brand — the same table heic-decode accepts,
 * so true here means the decoder will take the file. Compatible brands are
 * deliberately ignored: AVIF lists `mif1` there and must not match. Bytes
 * beat both the reported MIME type and the filename; use this whenever the
 * buffer is in hand (upload ingestion, local draft Files) and the metadata
 * predicate everywhere bytes are not available.
 */
export function isHeicBuffer(bytes: Uint8Array | ArrayBuffer | null | undefined): boolean {
  if (!bytes) return false;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < 12) return false;
  const boxType = String.fromCharCode(...view.subarray(4, 8));
  if (boxType !== 'ftyp') return false;
  const brand = String.fromCharCode(...view.subarray(8, 12));
  return HEIC_FTYP_BRANDS.includes(brand);
}

/** `IMG_4032.heic` → `IMG_4032.webp`; falls back to appending `.webp` when unnamed. */
export function toWebpFilename(fileName: string): string {
  const stem = (fileName || '').replace(/\.[^./\\]+$/, '');
  return `${stem || 'image'}.webp`;
}
