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
  /** Each face inside a group stack: 32px at 40. */
  faceRatio: 0.9,
  /**
   * The gap the front face cuts out of the one behind it: 2px at 40.
   *
   * Drawn as a border in the surface color, not as a real alpha mask. A mask
   * needs an SVG or a MaskedView per row, and this list has to stay smooth
   * while it scrolls — the ring is indistinguishable from a cut-out as long as
   * it matches what is behind it, which `ringClassName` is for.
   */
  ringRatio: 0.05,
  /** Member-count bubble: 18px at 40. */
  badgeRatio: 0.55,
} as const;

export function avatarRadius(size: number): number {
  return size / AVATAR_GEOMETRY.radiusDivisor;
}

export function groupFaceSize(size: number): number {
  return Math.round(size * AVATAR_GEOMETRY.faceRatio);
}

export function avatarRing(size: number): number {
  return Math.max(1, Math.round(size * AVATAR_GEOMETRY.ringRatio));
}

export function avatarBadgeSize(size: number): number {
  return Math.round(size * AVATAR_GEOMETRY.badgeRatio);
}
