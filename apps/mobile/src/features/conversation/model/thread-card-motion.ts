/** A box on screen, in window points. */
export type ThreadCardRect = { x: number; y: number; width: number; height: number };
/** What the card grows out of: its frame, and its corners when not a strip's. */
export type ThreadCardSource = ThreadCardRect & { radius?: number };

/** The box `progress` of the way from `from` to `to` (0 is `from`, 1 is `to`). */
export function blendThreadCardRect(
  from: ThreadCardRect,
  to: ThreadCardRect,
  progress: number,
): ThreadCardRect {
  'worklet';
  const mix = (a: number, b: number): number => a + (b - a) * progress;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}

/**
 * How opaque the morphing card is: it fades in over the first `share` of the
 * grow, so the strip shows through while the card is still about its size.
 */
export function threadCardMorphOpacity(progress: number, share: number): number {
  'worklet';
  if (share <= 0) return 1;
  return Math.min(Math.max(progress / share, 0), 1);
}

/**
 * How opaque the thread inside the morphing card is: hidden until `from` of
 * the grow, then in over `span`. While the card is near the strip's size it is
 * a plain surface, so its text never lies over the strip's or the room's.
 */
export function threadCardMorphContentOpacity(
  progress: number,
  from: number,
  span: number,
): number {
  'worklet';
  if (span <= 0) return progress >= from ? 1 : 0;
  return Math.min(Math.max((progress - from) / span, 0), 1);
}

/**
 * iOS's rubber band: past an edge a drag moves less the further it goes, and
 * never more than `limit`. `offset` is how far past the edge the finger is.
 */
export function rubberBand(offset: number, limit: number, coefficient = 0.55): number {
  'worklet';
  if (offset <= 0 || limit <= 0) return 0;
  return (1 - 1 / ((offset * coefficient) / limit + 1)) * limit;
}

/**
 * Whether letting go of a drag closes the card: pulled past a quarter of its
 * height (at most `maxDistance`), or flicked down fast enough, as long as it
 * is not moving back up.
 */
export function threadCardDragDismisses(
  dragY: number,
  velocityY: number,
  cardHeight: number,
  maxDistance: number,
  flickVelocity: number,
): boolean {
  'worklet';
  if (velocityY < 0 && dragY < maxDistance) return false;
  if (velocityY >= flickVelocity && dragY > 0) return true;
  return dragY >= Math.min(cardHeight / 4, maxDistance);
}

/**
 * The scrim's opacity while the card is dragged: full at rest, gone once the
 * card has travelled its own height.
 */
export function threadCardScrimOpacity(
  progress: number,
  dragY: number,
  cardHeight: number,
): number {
  'worklet';
  const dragShare = cardHeight > 0 ? Math.min(Math.max(dragY, 0) / cardHeight, 1) : 0;
  return Math.min(Math.max(progress, 0), 1) * (1 - dragShare);
}
