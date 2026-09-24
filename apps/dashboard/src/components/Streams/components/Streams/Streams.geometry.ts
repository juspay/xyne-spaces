/**
 * Where every column sits, derived from state rather than measured off the DOM.
 *
 * The strip used to answer "which column is under this pointer?" by querying
 * `[data-column]` and reading a rect off each node. That is correct exactly as
 * long as every column is mounted — and it stops being correct the moment the
 * strip is virtualised, because an off-screen column has no node to measure and
 * silently drops out of the answer. A drop target that only considers what
 * happens to be on screen is not a drop target.
 *
 * Column widths are already state (`Column.width`, clamped), so the layout is
 * computable without touching the document at all. That makes this the *source*
 * the DOM agrees with, not a cache of what the DOM said — and it is cheaper
 * besides: one pass over an array instead of N forced reflows.
 *
 * Everything here is pure and works in content space — pixels from the strip's
 * content origin, which is where `scrollLeft` is also measured. Viewport
 * conversion is the caller's job and lives in `toContentX` / `toClientX`, the
 * only two functions in this file that know a document exists.
 */

/**
 * The resize handle between two columns.
 *
 * `w-2` on `ColumnResizeHandle`, `shrink-0`, and present between every pair —
 * so a column's advance along the strip is its own width plus this. It is easy
 * to leave out and expensive to: the error is not 8px, it is 8px *per column*,
 * which puts the far end of a nineteen-column stream 152px away from where the
 * arithmetic thinks it is.
 */
export const HANDLE_PX = 8;

export interface ColumnStrides {
  /** Left edge of each column in content space. */
  readonly left: readonly number[];
  /** Each column's own width, excluding its handle. */
  readonly width: readonly number[];
  /** Advance of every column and handle together — the strip's scrollable content. */
  readonly total: number;
}

/**
 * Lay out `widths` end to end, each followed by its handle.
 *
 * `lead` is the strip's own padding-left, which changes with whether a pinned
 * run is holding the left edge — so it is passed in rather than assumed.
 */
export const columnStrides = (widths: readonly number[], lead = 0): ColumnStrides => {
  const left: number[] = [];
  let x = lead;
  for (let index = 0; index < widths.length; index += 1) {
    left.push(x);
    x += (widths[index] ?? 0) + HANDLE_PX;
  }
  return { left, width: widths, total: x - lead };
};

export interface Slot {
  /**
   * Where the column lands, as an index into the stream **with the excluded
   * columns removed** — the array `reorder` splices against, so the caller
   * applies no off-by-one of its own.
   */
  readonly slot: number;
  /**
   * Full-array index of the column the insertion marker sits *before*, or null
   * when the slot is past the last candidate and the marker belongs on that
   * column's trailing edge instead.
   */
  readonly aheadIndex: number | null;
}

/**
 * Which slot `contentX` is aiming at, skipping `excluded`.
 *
 * `excluded` is the dragged column and the pane travelling with it. They keep
 * their place in the layout while in hand — a drag is a transform, and
 * transforms do not reflow — so they still occupy space here, they just cannot
 * be aimed at. That is why this takes a full-layout `strides` and an exclusion
 * set rather than strides built from the remaining columns: the positions must
 * be the real ones, only the candidates are fewer.
 *
 * The rule is the one the rects gave: the first candidate whose midpoint is
 * right of the pointer takes the column before it, and running out of
 * candidates means the end of the stream.
 */
export const slotAt = (
  contentX: number,
  strides: ColumnStrides,
  excluded: ReadonlySet<number> = new Set(),
): Slot => {
  let slot = 0;
  for (let index = 0; index < strides.left.length; index += 1) {
    if (excluded.has(index)) continue;
    const midpoint = (strides.left[index] ?? 0) + (strides.width[index] ?? 0) / 2;
    if (contentX < midpoint) return { slot, aheadIndex: index };
    slot += 1;
  }
  return { slot, aheadIndex: null };
};

/** The last index not in `excluded`, or null when every column is excluded. */
export const lastCandidate = (
  strides: ColumnStrides,
  excluded: ReadonlySet<number> = new Set(),
): number | null => {
  for (let index = strides.left.length - 1; index >= 0; index -= 1) {
    if (!excluded.has(index)) return index;
  }
  return null;
};

/** Content-space left edge of `index`, or null when it is out of range. */
export const leftOf = (strides: ColumnStrides, index: number): number | null =>
  strides.left[index] ?? null;

/** Content-space right edge of `index` — its own width, not counting the handle. */
export const rightOf = (strides: ColumnStrides, index: number): number | null => {
  const left = strides.left[index];
  if (left === undefined) return null;
  return left + (strides.width[index] ?? 0);
};

// --------------------------------------------------------------- viewport

/**
 * Viewport x to content space.
 *
 * `scrollLeft` is measured from the content origin and `getBoundingClientRect`
 * from the border box, so the strip's own left inset is the difference between
 * them and has to be subtracted once, here, rather than remembered at each call
 * site.
 */
export const toContentX = (clientX: number, strip: HTMLElement, lead = 0): number =>
  clientX - strip.getBoundingClientRect().left + strip.scrollLeft - lead;

/** Content space back to viewport x. The exact inverse of `toContentX`. */
export const toClientX = (contentX: number, strip: HTMLElement, lead = 0): number =>
  contentX + strip.getBoundingClientRect().left - strip.scrollLeft + lead;

/**
 * Cross-axis band the columns occupy, in viewport coordinates.
 *
 * Every column is `self-stretch` inside the strip's `paddingBlock`, so they all
 * share one top and one height — there is no need to measure a column to find
 * out where a marker's ends go.
 */
export const columnBand = (
  strip: HTMLElement,
  gutter: number,
): { readonly top: number; readonly height: number } => {
  const rect = strip.getBoundingClientRect();
  return { top: rect.top + gutter, height: Math.max(0, rect.height - gutter * 2) };
};

// ------------------------------------------------------------------- dev

/** Sub-pixel layout is normal; a real disagreement is never this small. */
const TOLERANCE_PX = 1;

/**
 * Long enough to outlast any width tween in the feature — the column open and
 * close clocks and the focus flip all finish well inside it.
 */
const SETTLE_MS = 500;

/** One pass of the comparison. Empty means the document agrees. */
const measureDrift = (
  strip: HTMLElement,
  ids: readonly string[],
  strides: ColumnStrides,
  lead: number,
): string[] => {
  const drift: string[] = [];
  ids.forEach((id, index) => {
    const node = strip.querySelector<HTMLElement>(`[data-column="${id}"]`);
    if (!node) return;
    // A transformed node is being dragged; its rect is deliberately not its slot.
    if (node.style.transform !== '') return;
    const rect = node.getBoundingClientRect();
    const expectedLeft = toClientX(strides.left[index] ?? 0, strip, lead);
    const expectedWidth = strides.width[index] ?? 0;
    const dx = Math.abs(rect.left - expectedLeft);
    const dw = Math.abs(rect.width - expectedWidth);
    if (dx > TOLERANCE_PX || dw > TOLERANCE_PX) {
      drift.push(
        `${id}: left ${rect.left.toFixed(1)} vs ${expectedLeft.toFixed(1)} (${dx.toFixed(1)}px), ` +
          `width ${rect.width.toFixed(1)} vs ${expectedWidth.toFixed(1)} (${dw.toFixed(1)}px)`,
      );
    }
  });
  return drift;
};

/**
 * Check the arithmetic against the document, in development only.
 *
 * This exists for the window in which both answers are available. While every
 * column is still mounted the DOM can be asked the same question this file
 * answers, and the two must agree — so the geometry is proven *before*
 * virtualisation removes the second opinion. Once columns unmount this can only
 * check what is on screen, which is still worth having, but the version that
 * catches a systematic error is the one that runs before the switch is thrown.
 *
 * **A mismatch has to survive `SETTLE_MS` to count.** React's own flags are not
 * enough to know the strip has stopped moving: `opening` clears when the state
 * says the column has arrived, while the CSS width transition it started is
 * still painting. Sampling on that boundary reports a column caught at 103px on
 * its way to 360 — a disagreement about *when*, not about where columns go. So
 * the first pass only nominates, and the second pass, a settle later, is what
 * reports. A real error is stationary and survives both; a tween does not.
 *
 * Returns a canceller, and the caller must use it. `strides` is the widths as
 * they were at the call, so a resize inside the settle window leaves the second
 * pass comparing against numbers that have since been superseded — which is a
 * false positive rather than a missed one, but noise either way. Cancelling on
 * the way out means the only check that ever reports is the one holding the
 * current widths.
 */
export const assertStridesMatchDom = (
  strip: HTMLElement,
  ids: readonly string[],
  strides: ColumnStrides,
  lead = 0,
  label = 'strides',
): (() => void) => {
  if (!import.meta.env.DEV) return (): void => {};
  if (measureDrift(strip, ids, strides, lead).length === 0) return (): void => {};
  const timer = window.setTimeout(() => {
    // The strip can be torn down inside the settle window.
    if (!strip.isConnected) return;
    const drift = measureDrift(strip, ids, strides, lead);
    if (drift.length === 0) return;
    // eslint-disable-next-line no-console
    console.error(`[streams:${label}] geometry disagrees with the DOM\n${drift.join('\n')}`);
  }, SETTLE_MS);
  return (): void => window.clearTimeout(timer);
};
