import {
  PHOTO_GRID_GAP,
  PHOTO_GRID_MAX_CELLS,
  PHOTO_GRID_MAX_WIDTH,
  PHOTO_MAX_ASPECT,
  PHOTO_MIN_ASPECT,
  PHOTO_UNKNOWN_ASPECT,
} from '../constants';

/** Where one photo sits inside the grid, in points from its top left. */
export type PhotoCell = { left: number; top: number; width: number; height: number };

type PhotoGridLayout = {
  width: number;
  height: number;
  /** One per shown photo, in message order; at most four. */
  cells: PhotoCell[];
  /** Photos past the fourth, counted on the fourth as "+N". */
  overflowCount: number;
  /** A lone portrait photo is cut from the top, so faces and headers stay in. */
  cropFromTop: boolean;
};

/** What a message attachment's metadata says about its picture; missing fields are null. */
type MediaMetadata = {
  aspectRatio: number | null;
  durationSeconds: number | null;
  thumbUri: string | null;
};

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * A width / height ratio the grid can lay out, else null (unknown). The grid
 * and the row's height guess both read a photo's shape through this, so they
 * agree on a picture with a zero or missing side.
 */
export function knownAspectRatio(ratio: number | null): number | null {
  return positive(ratio) ? ratio : null;
}

/** Reads width, height, duration and a cached thumbnail from an attachment's untyped metadata. */
export function mediaMetadata(metadata: unknown): MediaMetadata {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  return {
    aspectRatio:
      positive(meta['width']) && positive(meta['height'])
        ? knownAspectRatio(meta['width'] / meta['height'])
        : null,
    durationSeconds: positive(meta['duration']) ? meta['duration'] : null,
    thumbUri: typeof meta['thumbUri'] === 'string' && meta['thumbUri'] ? meta['thumbUri'] : null,
  };
}

/**
 * The flat grid for `count` photos or videos in a body `bodyWidth` wide
 * (Figma "Photos in a message"): one keeps its shape between 4:5 and 2:1,
 * wide ones filling the width and tall ones the same height; two sit side by
 * side as squares; three put one large on the left of two stacked; four or
 * more make a 2 × 2 square whose fourth says how many more there are. Only
 * the first photo's shape is known, so it alone decides the single layout.
 */
export function photoGridLayout(
  count: number,
  firstAspectRatio: number | null,
  bodyWidth: number,
): PhotoGridLayout {
  const width = Math.max(0, Math.min(PHOTO_GRID_MAX_WIDTH, bodyWidth));
  const half = (width - PHOTO_GRID_GAP) / 2;

  if (count <= 0) return { width: 0, height: 0, cells: [], overflowCount: 0, cropFromTop: false };

  if (count === 1) {
    const raw = firstAspectRatio ?? PHOTO_UNKNOWN_ASPECT;
    const aspect = Math.min(PHOTO_MAX_ASPECT, Math.max(PHOTO_MIN_ASPECT, raw));
    const cellWidth = aspect >= 1 ? width : width * aspect;
    const height = aspect >= 1 ? width / aspect : width;
    return {
      width: cellWidth,
      height,
      cells: [{ left: 0, top: 0, width: cellWidth, height }],
      overflowCount: 0,
      cropFromTop: raw < 1,
    };
  }

  if (count === 2) {
    return {
      width,
      height: half,
      cells: [
        { left: 0, top: 0, width: half, height: half },
        { left: half + PHOTO_GRID_GAP, top: 0, width: half, height: half },
      ],
      overflowCount: 0,
      cropFromTop: false,
    };
  }

  if (count === 3) {
    const large = ((width - PHOTO_GRID_GAP) * 2) / 3;
    const small = width - PHOTO_GRID_GAP - large;
    const height = (width * 2) / 3;
    const stacked = (height - PHOTO_GRID_GAP) / 2;
    const right = large + PHOTO_GRID_GAP;
    return {
      width,
      height,
      cells: [
        { left: 0, top: 0, width: large, height },
        { left: right, top: 0, width: small, height: stacked },
        { left: right, top: stacked + PHOTO_GRID_GAP, width: small, height: stacked },
      ],
      overflowCount: 0,
      cropFromTop: false,
    };
  }

  const far = half + PHOTO_GRID_GAP;
  return {
    width,
    height: width,
    cells: [
      { left: 0, top: 0, width: half, height: half },
      { left: far, top: 0, width: half, height: half },
      { left: 0, top: far, width: half, height: half },
      { left: far, top: far, width: half, height: half },
    ],
    overflowCount: Math.max(0, count - PHOTO_GRID_MAX_CELLS),
    cropFromTop: false,
  };
}
