import { jpegDimensions } from './jpegDimensions';

const segment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
};

/** SOI, an APP0 segment, then a frame header of the given marker and size. */
const jpeg = (width: number, height: number, sof = 0xc0): Buffer =>
  Buffer.from([
    0xff,
    0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]),
    ...segment(sof, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]),
  ]);

describe('jpegDimensions', () => {
  it('reads a baseline frame header after other segments', () => {
    expect(jpegDimensions(jpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
  });

  it('reads a progressive frame header', () => {
    expect(jpegDimensions(jpeg(320, 180, 0xc2))).toEqual({ width: 320, height: 180 });
  });

  it('reports dimensions larger than the file size would suggest', () => {
    expect(jpegDimensions(jpeg(30000, 20000))).toEqual({ width: 30000, height: 20000 });
  });

  it('does not mistake a Huffman table (DHT) for a frame header', () => {
    const buffer = Buffer.from([
      0xff,
      0xd8,
      ...segment(0xc4, [0, 1, 2, 3, 4, 5]),
      ...segment(0xc0, [8, 0, 10, 0, 20, 3]),
    ]);
    expect(jpegDimensions(buffer)).toEqual({ width: 20, height: 10 });
  });

  it('returns null without a frame header', () => {
    expect(jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegDimensions(Buffer.from([0xff, 0xd8, ...segment(0xe0, [1, 2])]))).toBeNull();
  });

  it('returns null on a truncated or malformed header', () => {
    expect(jpegDimensions(jpeg(1280, 720).subarray(0, 17))).toBeNull();
    expect(jpegDimensions(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00]))).toBeNull();
  });
});
