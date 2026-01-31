export interface GridLayout {
  columns: number;
  rows: number;
  maxTiles: number;
  minWidth: number;
  minHeight: number;
}

// Grid layout configurations based on participant count and screen size
export const GRID_LAYOUTS: GridLayout[] = [
  { columns: 1, rows: 1, maxTiles: 1, minWidth: 0, minHeight: 0 },
  { columns: 2, rows: 1, maxTiles: 2, minWidth: 560, minHeight: 0 },
  { columns: 1, rows: 2, maxTiles: 2, minWidth: 0, minHeight: 400 },
  { columns: 2, rows: 2, maxTiles: 4, minWidth: 560, minHeight: 400 },
  { columns: 3, rows: 2, maxTiles: 6, minWidth: 700, minHeight: 400 },
  { columns: 3, rows: 3, maxTiles: 9, minWidth: 700, minHeight: 600 },
  { columns: 4, rows: 3, maxTiles: 12, minWidth: 960, minHeight: 600 },
  { columns: 4, rows: 4, maxTiles: 16, minWidth: 960, minHeight: 800 },
];

/**
 * Select the optimal grid layout based on participant count and container dimensions
 */
export function selectGridLayout(
  participantCount: number,
  containerWidth: number,
  containerHeight: number,
  maxTiles?: number,
): GridLayout {
  // Cap at maxTiles if provided (e.g., 4 for compact view, 16 for full view)
  const cappedCount = maxTiles
    ? Math.min(participantCount, maxTiles)
    : Math.min(participantCount, 16);

  // Filter layouts that can fit the participant count
  const validLayouts = GRID_LAYOUTS.filter(layout => layout.maxTiles >= cappedCount);

  // Find the best fitting layout based on container size
  for (const layout of validLayouts) {
    // Check if container is large enough for this layout
    if (containerWidth >= layout.minWidth && containerHeight >= layout.minHeight) {
      return layout;
    }
  }

  // Fallback to the smallest valid layout if container is too small
  return validLayouts[0]!;
}
