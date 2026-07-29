export interface VisibleRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const CLIPPING = new Set(['auto', 'scroll', 'hidden']);

/**
 * The region of `el` the user can actually see: its own rect clipped by every
 * scrollable/hidden ancestor, on both axes.
 *
 * A viewer's own rect is not the visible area — an ancestor may clip part of it
 * away. Measuring the viewer alone then reports a match sitting in the hidden
 * strip as "visible", so the reveal is skipped and the user stares at a match
 * they cannot see. Grids clip on both axes, so both are intersected.
 */
export const getVisibleRect = (el: HTMLElement): VisibleRect => {
  const rect = el.getBoundingClientRect();
  let top = rect.top;
  let bottom = rect.bottom;
  let left = rect.left;
  let right = rect.right;

  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (CLIPPING.has(style.overflowY) || CLIPPING.has(style.overflowX)) {
      const ancestor = node.getBoundingClientRect();
      if (CLIPPING.has(style.overflowY)) {
        top = Math.max(top, ancestor.top);
        bottom = Math.min(bottom, ancestor.bottom);
      }
      if (CLIPPING.has(style.overflowX)) {
        left = Math.max(left, ancestor.left);
        right = Math.min(right, ancestor.right);
      }
    }
    node = node.parentElement;
  }

  return { top, bottom: Math.max(top, bottom), left, right: Math.max(left, right) };
};
