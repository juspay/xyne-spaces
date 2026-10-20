/**
 * Every size in the avatar, as a ratio of its slot.
 *
 * One number drives the whole component, so a 40px avatar and a 64px one are
 * the same drawing at two scales. The comments give what each resolves to at
 * 40px, which is the size the design was drawn at.
 */
export const AVATAR_GEOMETRY = {
  /** Squircle corner: 13.33px at 40, the radius the design specifies. */
  radiusDivisor: 3,
  /** Each face inside a group stack: 36px at 40. */
  faceRatio: 0.9,
  /** The clear gap a shape cuts around itself in whatever sits under it: 2px at 40. */
  gapRatio: 0.05,
  /** Member-count bubble: 22px at 40. */
  badgeRatio: 0.55,
  /** Corner badge, the DM list's star: 16px at 40. */
  cornerBadgeRatio: 0.4,
  /**
   * How far a bubble hangs past the corner of the face it sits on, as a share
   * of its own diameter.
   */
  overhang: 0.25,
} as const;

export function avatarRadius(size: number): number {
  return size / AVATAR_GEOMETRY.radiusDivisor;
}

export function groupFaceSize(size: number): number {
  return Math.round(size * AVATAR_GEOMETRY.faceRatio);
}

export function avatarGap(size: number): number {
  return Math.max(1, Math.round(size * AVATAR_GEOMETRY.gapRatio));
}

export function avatarBadgeSize(size: number): number {
  return Math.round(size * AVATAR_GEOMETRY.badgeRatio);
}

/** The corner badge's circle, which is also the hole it sits in. */
export function avatarCornerBadgeSize(size: number): number {
  return Math.round(size * AVATAR_GEOMETRY.cornerBadgeRatio);
}

/** A rounded rect; a circle when `radius` is half its side. */
export type AvatarRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

export type AvatarFaceSlot = {
  rect: AvatarRect;
  /** What sits on top of this face, in the face's own coordinates. */
  holes: AvatarRect[];
};

export type AvatarLayout = {
  /** Back to front: the order they paint in. */
  faces: AvatarFaceSlot[];
  /** The group's member count, top-right of the front face. */
  countBubble: AvatarRect | null;
  /** The corner badge's circle, bottom-right of the front face. */
  cornerBadge: AvatarRect | null;
};

type AvatarLayoutOptions = {
  isGroup: boolean;
  hasCornerBadge?: boolean;
};

/**
 * Where every part of the avatar sits in its slot, and what each face has to
 * be cut away under.
 *
 * Shapes are separated by real cut-outs, not by rings painted in a guessed
 * background colour: each face is masked by the shapes above it, grown by the
 * gap, so whatever is truly behind the avatar shows through.
 */
export function avatarLayout(
  size: number,
  { isGroup, hasCornerBadge = false }: AvatarLayoutOptions,
): AvatarLayout {
  const gap = avatarGap(size);
  const inset = 0.5 - AVATAR_GEOMETRY.overhang;

  const front = isGroup
    ? square(size - groupFaceSize(size), 0, groupFaceSize(size))
    : square(0, 0, size);

  // The badge is its own hole: whatever it holds sits inside with room to spare.
  const cornerSize = avatarCornerBadgeSize(size);
  const cornerBadge = hasCornerBadge
    ? circleAt(
        front.x + front.width - cornerSize * inset,
        front.y + front.height - cornerSize * inset,
        cornerSize,
      )
    : null;

  if (!isGroup) {
    return {
      faces: [{ rect: front, holes: cornerBadge ? [cornerBadge] : [] }],
      countBubble: null,
      cornerBadge,
    };
  }

  const back = square(0, 0, front.width);
  const badge = avatarBadgeSize(size);
  const countBubble = circleAt(
    front.x + front.width - badge * inset,
    front.y + badge * inset,
    badge,
  );
  const aboveFront = [grow(countBubble, gap), ...(cornerBadge ? [cornerBadge] : [])];

  return {
    faces: [
      { rect: back, holes: [grow(front, gap), ...aboveFront].map(hole => toLocal(hole, back)) },
      { rect: front, holes: aboveFront.map(hole => toLocal(hole, front)) },
    ],
    countBubble,
    cornerBadge,
  };
}

function square(x: number, y: number, side: number): AvatarRect {
  return { x, y, width: side, height: side, radius: avatarRadius(side) };
}

function circleAt(cx: number, cy: number, diameter: number): AvatarRect {
  const r = diameter / 2;
  return { x: cx - r, y: cy - r, width: diameter, height: diameter, radius: r };
}

function grow(rect: AvatarRect, by: number): AvatarRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
    radius: rect.radius + by,
  };
}

function toLocal(rect: AvatarRect, face: AvatarRect): AvatarRect {
  return { ...rect, x: rect.x - face.x, y: rect.y - face.y };
}
