export interface GridLayout {
  columns: number;
  rows: number;
  maxTiles: number;
  /** Optimal per-tile width in px, maintaining TILE_ASPECT_RATIO within the container. */
  tileWidth: number;
  /** Optimal per-tile height in px, maintaining TILE_ASPECT_RATIO within the container. */
  tileHeight: number;
}

// Target tile aspect ratio (16:9) — used only for the informational
// `tileWidth`/`tileHeight` fields below (kept for potential future use); the
// actual grid CSS in `ParticipantGrid.tsx` renders stretchy `1fr` cells.
const TILE_ASPECT_RATIO = 16 / 9;

/**
 * Canonical column count for a given tile count — a classic ceil(sqrt(n))
 * grid (2 tiles -> 2 columns side-by-side, 4 -> 2x2, 9 -> 3x3, etc.), the same
 * approach most video-call UIs (Meet, Zoom, Discord) use.
 *
 * Deliberately independent of container size. An earlier version picked
 * whichever column count maximized tile area for the CURRENT container
 * dimensions — which meant the arrangement itself (side-by-side vs. stacked)
 * would flip every time the container's aspect ratio changed even slightly,
 * e.g. opening/closing the thread sidebar shrinks the width and could flip 2
 * participants from side-by-side to stacked. That reflow was the actual bug
 * ("why does it go horizontal/vertical when I open the sidebar?"). Keeping
 * the arrangement stable per participant count and letting each cell stretch
 * to fill whatever space is available (see `ParticipantGrid.tsx`, `1fr` grid
 * + `object-cover` on the video) matches how real call UIs behave — the
 * arrangement never changes on resize, only each tile's cropped framing does.
 */
function canonicalColumns(count: number): number {
  if (count <= 1) return 1;
  return Math.ceil(Math.sqrt(count));
}

function computeTileSize(
  columns: number,
  rows: number,
  containerWidth: number,
  containerHeight: number,
  gap: number,
): { tileWidth: number; tileHeight: number } {
  const safeWidth = containerWidth > 0 ? containerWidth : 1;
  const safeHeight = containerHeight > 0 ? containerHeight : 1;

  let tileWidth = (safeWidth - gap * (columns - 1)) / columns;
  let tileHeight = tileWidth / TILE_ASPECT_RATIO;

  const totalHeight = tileHeight * rows + gap * (rows - 1);
  if (totalHeight > safeHeight) {
    tileHeight = (safeHeight - gap * (rows - 1)) / rows;
    tileWidth = tileHeight * TILE_ASPECT_RATIO;
  }

  return { tileWidth: Math.max(0, tileWidth), tileHeight: Math.max(0, tileHeight) };
}

/**
 * Select the grid layout for a given participant count. Columns/rows come
 * from the count-only canonical formula above (stable across resizes);
 * container dimensions are only used to compute the informational
 * `tileWidth`/`tileHeight` fields.
 */
export function selectGridLayout(
  participantCount: number,
  containerWidth: number,
  containerHeight: number,
  maxTiles?: number,
  gap = 12,
): GridLayout {
  // Cap at maxTiles if provided (e.g., 4 for compact view, 16 for full view)
  const cappedCount = Math.max(
    1,
    maxTiles ? Math.min(participantCount, maxTiles) : Math.min(participantCount, 16),
  );

  const columns = Math.max(1, Math.min(cappedCount, canonicalColumns(cappedCount)));
  const rows = Math.max(1, Math.ceil(cappedCount / columns));

  const { tileWidth, tileHeight } = computeTileSize(
    columns,
    rows,
    containerWidth,
    containerHeight,
    gap,
  );

  return {
    columns,
    rows,
    maxTiles: Math.max(1, columns * rows),
    tileWidth,
    tileHeight,
  };
}
