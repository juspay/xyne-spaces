import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import decode from 'heic-decode';
import { convertHeicToWebp, isHeicMimetype, toWebpFilename } from './heicToWebp';

const fixture = fs.readFileSync(
  path.join(__dirname, '__tests__/fixtures/heic-test-photo.heic'),
);

describe('heicToWebp', () => {
  it('detects the HEIC/HEIF mimetype family', () => {
    expect(isHeicMimetype('image/heic')).toBe(true);
    expect(isHeicMimetype('image/heif')).toBe(true);
    expect(isHeicMimetype('image/heic-sequence')).toBe(true);
    expect(isHeicMimetype('IMAGE/HEIF')).toBe(true);
    expect(isHeicMimetype('image/heic; charset=binary')).toBe(true);
    expect(isHeicMimetype('image/jpeg')).toBe(false);
    expect(isHeicMimetype('image/png')).toBe(false);
    expect(isHeicMimetype('')).toBe(false);
    expect(isHeicMimetype(null)).toBe(false);
    expect(isHeicMimetype(undefined)).toBe(false);
  });

  it('rewrites heic filenames to webp', () => {
    expect(toWebpFilename('photo.heic')).toBe('photo.webp');
    expect(toWebpFilename('IMG_0001.HEIF')).toBe('IMG_0001.webp');
    expect(toWebpFilename('no-extension')).toBe('no-extension.webp');
    expect(toWebpFilename(null)).toBe('image.webp');
  });

  it('converts a HEIC buffer to a valid WebP container', async () => {
    const webp = await convertHeicToWebp(fixture);

    // RIFF....WEBP magic bytes
    expect(webp.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP');

    const metadata = await sharp(webp).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(150);
  });

  it('is lossless: decoded RGBA pixels survive the round trip bit-for-bit', async () => {
    const { width, height, data } = await decode({ buffer: fixture });
    const webp = await convertHeicToWebp(fixture);

    const roundTrip = await sharp(webp)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(roundTrip.info.width).toBe(width);
    expect(roundTrip.info.height).toBe(height);
    expect(roundTrip.info.channels).toBe(4);
    expect(Buffer.compare(Buffer.from(data), roundTrip.data)).toBe(0);
  });

  it('rejects undecodable input so the caller can fall back to the original bytes', async () => {
    await expect(convertHeicToWebp(Buffer.from('not a heic file'))).rejects.toThrow();
  });
});
