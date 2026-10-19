/** SOFn markers (baseline, progressive, lossless, arithmetic); not DHT/JPG/DAC. */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * Width and height from a JPEG's frame header, or null if it can't be found. Reads only
 * marker headers, never decodes, so it is safe on untrusted input.
 */
export const jpegDimensions = (buffer: Buffer): { width: number; height: number } | null => {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1]!;
    // Fill bytes and standalone markers (RSTn, TEM) carry no length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any frame header
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
};
