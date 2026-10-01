/**
 * A whole canvas arriving at once (a draft opened from Agent Hub, or a reload)
 * comes in as one piece: it fades in out of a blur and settles into place.
 *
 * The animation only fills backwards, so nothing stays on the column once it
 * has landed: a leftover filter or transform would make it the containing
 * block for fixed-position menus inside it.
 */

const FOCUS_IN_MS = 420;
const FOCUS_IN_BLUR_PX = 12;
/** The canvas comes down this far into place. */
const FOCUS_IN_DROP_PX = 6;
const FOCUS_IN_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
const REDUCED_FADE_MS = 200;

/** Brings `column` into focus; the returned function stops it. */
export function focusInCanvas(column: HTMLElement): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = reduced
    ? column.animate({ opacity: [0, 1] }, { duration: REDUCED_FADE_MS, easing: 'ease-out' })
    : column.animate(
        {
          opacity: [0, 1],
          filter: [`blur(${FOCUS_IN_BLUR_PX}px)`, 'blur(0px)'],
          transform: [`translateY(-${FOCUS_IN_DROP_PX}px)`, 'none'],
        },
        { duration: FOCUS_IN_MS, easing: FOCUS_IN_EASE, fill: 'backwards' },
      );
  return () => animation.cancel();
}
