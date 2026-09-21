/**
 * HEIC/HEIF attachment helpers (client side).
 *
 * iPhones send HEIC photos, which most browsers cannot decode (Safari only).
 * The uploaded original stays byte-exact in storage; the backend produces
 * browser-renderable WebP renditions lazily at download time:
 *
 *   GET /attachments/:id/download?format=webp — full-size lossy (q85) WebP
 *   GET /attachments/:id/thumbnail            — ≤1024px WebP, generated on demand
 *
 * Detection and filename derivation live in @xyne/shared so the client and
 * backend agree on what counts as HEIC; this module adds the client-side
 * URL derivation plus the local (pre-upload) draft-preview conversion.
 */

import { isHeicAttachment, isHeicBuffer, toWebpFilename } from '@xyne/shared';

export { isHeicAttachment, toWebpFilename };

/**
 * Byte-level HEIC check for a local File: reads the 12-byte ftyp head and
 * trusts it over the browser's reported type/extension, which mislabels
 * renamed HEICs (e.g. a .jpg carrying HEIC bytes) and blank-types real ones.
 * Resolves null when the head can't be read — callers fall back to
 * isHeicAttachment metadata.
 */
export async function sniffHeicFile(file: File): Promise<boolean | null> {
  try {
    return isHeicBuffer(await file.slice(0, 12).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Download URL for the WebP rendition of an HEIC attachment. Accepts either
 * an attachment id or an already-resolved URL.
 */
export function heicWebpDownloadUrl(source: string): string {
  if (!source) return source;
  const base =
    source.startsWith('/') || source.startsWith('http')
      ? source
      : `/attachments/${source}/download`;
  // fileUrl can already carry a query string (e.g. signed URLs) — append with
  // the right separator instead of blindly concatenating another '?'.
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}format=webp`;
}

const WEB_RENDERABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/jpg',
  'image/png',
  'image/apng',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
]);

/**
 * Whether an image blob's MIME type can render in a browser <img>.
 */
export function isWebRenderableImageType(mimeType: string): boolean {
  const type = ((mimeType || '').split(';')[0] ?? '').trim().toLowerCase();
  return WEB_RENDERABLE_IMAGE_TYPES.has(type);
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

export interface HeicPreviewConversion {
  blob: Blob;
  width: number;
  height: number;
}

const heicPreviewConversionCache = new WeakMap<File, Promise<HeicPreviewConversion>>();

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

export function convertHeicFileWithDimensions(file: File): Promise<HeicPreviewConversion> {
  const cached = heicPreviewConversionCache.get(file);
  if (cached) return cached;

  const conversion = (async (): Promise<HeicPreviewConversion> => {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/webp', quality: 0.9 });
    const webp = Array.isArray(result) ? result[0] : result;
    if (!webp) throw new Error('HEIC conversion produced no image');
    const bitmap = await createImageBitmap(webp);
    const { width, height } = bitmap;
    bitmap.close();
    return { blob: await downscaleForPreview(webp), width, height };
  })();

  heicPreviewConversionCache.set(
    file,
    conversion.catch(error => {
      heicPreviewConversionCache.delete(file);
      throw error;
    }),
  );
  return conversion;
}

export async function convertHeicFileToPreviewBlob(file: File): Promise<Blob> {
  const conversion = await convertHeicFileWithDimensions(file);
  return conversion.blob;
}
