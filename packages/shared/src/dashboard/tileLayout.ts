import { QueryVisualizationType } from '../zero/schema';

// Dashboard grid placement — the ONE source of truth for tile geometry.
// Consumed by the browser (componentEditor/queryPlanUtils, ComponentGrid) and
// by the backend AI tool endpoints (add_component auto-placement), so an
// AI-placed tile lands exactly where a human-placed one would.

export const GRID_COLS = 12;
export const DEFAULT_TILE_W = 6;
export const DEFAULT_TILE_H = 3;

const DEFAULT_TILE_SIZE_BY_TYPE: Partial<
  Record<QueryVisualizationType, { w: number; h: number }>
> = {
  [QueryVisualizationType.KPI]: { w: 3, h: 2 },
  [QueryVisualizationType.KPI_COMPARE]: { w: 3, h: 2 },
  [QueryVisualizationType.BAR_CHART]: { w: 8, h: 4 },
  [QueryVisualizationType.LINE_CHART]: { w: 8, h: 4 },
  [QueryVisualizationType.AREA_CHART]: { w: 8, h: 4 },
  [QueryVisualizationType.SCATTER_CHART]: { w: 8, h: 4 },
  [QueryVisualizationType.PIE_CHART]: { w: 4, h: 4 },
  [QueryVisualizationType.DONUT_CHART]: { w: 4, h: 4 },
  [QueryVisualizationType.FUNNEL]: { w: 4, h: 4 },
  [QueryVisualizationType.HEATMAP]: { w: 8, h: 5 },
  [QueryVisualizationType.DATA_TABLE]: { w: 12, h: 5 },
};

export interface GridPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function defaultSizeFor(visualType: QueryVisualizationType): { w: number; h: number } {
  return DEFAULT_TILE_SIZE_BY_TYPE[visualType] ?? { w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
}

export function serializePosition(pos: GridPosition): string {
  return JSON.stringify(pos);
}

export function parsePosition(raw: string): GridPosition | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    if (
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      typeof p.w !== 'number' ||
      typeof p.h !== 'number'
    ) {
      return null;
    }
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  } catch {
    return null;
  }
}

function rectsOverlap(a: GridPosition, b: GridPosition): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function nextOpenPosition(
  existingPositionStrings: ReadonlyArray<string>,
  size: { w: number; h: number },
): GridPosition {
  const existing = existingPositionStrings
    .map(parsePosition)
    .filter((r): r is GridPosition => r !== null);

  const maxBottom = existing.reduce((acc, r) => Math.max(acc, r.y + r.h), 0);
  const w = Math.min(size.w, GRID_COLS);

  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const candidate: GridPosition = { x, y, w, h: size.h };
      if (!existing.some((r) => rectsOverlap(candidate, r))) {
        return candidate;
      }
    }
  }

  return { x: 0, y: maxBottom, w, h: size.h };
}
