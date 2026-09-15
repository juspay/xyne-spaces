/**
 * Lossless HEIC/HEIF → WebP transcoding for attachment previews.
 *
 * Browsers other than Safari cannot rasterize HEIC, and the attachment
 * download endpoint intentionally serves HEIC as an opaque octet-stream
 * download (see SAFE_INLINE_MIME_TYPES in safeAttachmentDownload.ts). So a
 * HEIC attachment has no browser-renderable preview form.
 *
 * The fix is download-time conversion: preview fetches opt in with
 * `?format=webp` (GET /api/attachments/:attachmentId/download?format=webp)
 * and receive a losslessly transcoded WebP that every browser can render
 * inline. Manual downloads (no format param) always get the original bytes.
 *
 * Lossless guarantee: the HEIC bitstream is decoded to raw RGBA pixels with
 * `heic-decode`, those exact pixels are handed to sharp, and the WebP is
 * encoded with `lossless: true` (no quantization / no chroma subsampling).
 * Decoded pixels are preserved bit-for-bit; the only loss is whatever the
 * original HEIC encoder already applied upstream.
 */
import sharp from 'sharp';
import decode from 'heic-decode';

/** MIME types of the HEIC/HEIF family, as stored on MessageAttachment.mimetype. */
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

export const isHeicMimetype = (mimetype?: string | null): boolean => {
  const baseType = (mimetype || '').split(';')[0] ?? '';
  return HEIC_MIME_TYPES.has(baseType.trim().toLowerCase());
};

/** photo.heic → photo.webp (used for the converted preview's filename). */
export const toWebpFilename = (filename?: string | null): string => {
  const base = (filename || 'image').replace(/\.(heic|heif|hif)$/i, '');
  return `${base}.webp`;
};

/**
 * Convert a HEIC/HEIF buffer to a lossless WebP buffer.
 *
 * `heic-decode` (libheif compiled to WASM) yields raw RGBA pixels; sharp
 * encodes them to WebP with `lossless: true`, preserving the decoded pixels
 * exactly. Throws on undecodable input — callers fall back to the original.
 */
export const convertHeicToWebp = async (heicBuffer: Buffer): Promise<Buffer> => {
  const { width, height, data } = await decode({ buffer: heicBuffer });
  return sharp(Buffer.from(data), {
    raw: { width, height, channels: 4 },
  })
    .webp({ lossless: true })
    .toBuffer();
};
