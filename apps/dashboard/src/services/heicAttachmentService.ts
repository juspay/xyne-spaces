/**
 * HEIC/HEIF attachment helpers (client side).
 *
 * iPhones send HEIC photos, which most browsers cannot decode (Safari only).
 * The uploaded original stays byte-exact in storage; the backend produces
 * browser-renderable WebP renditions lazily at download time:
 *
 *   GET /attachments/:id/download?format=webp — full-size lossless WebP
 *   GET /attachments/:id/thumbnail            — ≤1024px WebP, generated on demand
 *
 * These helpers detect HEIC attachments (MIME type with filename fallback,
 * mirroring the backend's isHeicAttachment) and derive the rendition URL and
 * filename to use when fetching or downloading one.
 */

/** MIME types under which HEIC/HEIF attachments arrive. */
const HEIC_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/** Extensions treated as HEIC when the reported MIME type is unusable. */
const HEIC_EXTENSIONS: readonly string[] = ['.heic', '.heif', '.hif'];

/**
 * Whether an attachment is a HEIC/HEIF image. Detection by MIME type first,
 * then filename extension — browsers do not always report a HEIC MIME type
 * (Chrome on Linux reports application/octet-stream).
 */
export function isHeicAttachment(mimetype: string, fileName: string): boolean {
  const type = (mimetype || '').toLowerCase();
  if (HEIC_MIME_TYPES.has(type)) return true;

  const name = (fileName || '').toLowerCase();
  return HEIC_EXTENSIONS.some(extension => name.endsWith(extension));
}

/**
 * Download URL for the WebP rendition of an HEIC attachment. Accepts either
 * an attachment id or an already-resolved `/attachments/:id/download` URL.
 */
export function heicWebpDownloadUrl(source: string): string {
  const base =
    source.startsWith('/') || source.startsWith('http')
      ? source
      : `/attachments/${source}/download`;
  return `${base}?format=webp`;
}

/** `IMG_1234.heic` → `IMG_1234.webp`; falls back to appending `.webp` when unnamed. */
export function toWebpFilename(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0 && dot > fileName.lastIndexOf('/')) {
    return `${fileName.slice(0, dot)}.webp`;
  }
  return `${fileName || 'image'}.webp`;
}

/**
 * Convert a local HEIC file to a browser-renderable WebP blob entirely
 * client-side. Used for the sender's draft chips so the preview appears
 * immediately, without waiting for the upload to finish. Deliberately lossy
 * (≤2048px, q0.9) — the server's renditions remain the source of truth once
 * the file is sent. heic2any's WASM bundle is lazily imported on first use,
 * and results are cached per File object so remounts never re-convert.
 */
const HEIC_PREVIEW_MAX_EDGE = 2048;
const heicPreviewBlobCache = new WeakMap<File, Promise<Blob>>();

async function downscaleForPreview(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, HEIC_PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      if (scale === 1) return blob;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d');
      if (!context) return blob;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const resized = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/webp', 0.9),
      );
      return resized ?? blob;
    } finally {
      bitmap.close();
    }
  } catch {
    return blob;
  }
}

export function convertHeicFileToPreviewBlob(file: File): Promise<Blob> {
  const cached = heicPreviewBlobCache.get(file);
  if (cached) return cached;

  const conversion = (async (): Promise<Blob> => {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/webp', quality: 0.9 });
    const webp = Array.isArray(result) ? result[0] : result;
    if (!webp) throw new Error('HEIC conversion produced no image');
    return downscaleForPreview(webp);
  })();

  heicPreviewBlobCache.set(
    file,
    conversion.catch(error => {
      heicPreviewBlobCache.delete(file);
      throw error;
    }),
  );
  return conversion;
}
