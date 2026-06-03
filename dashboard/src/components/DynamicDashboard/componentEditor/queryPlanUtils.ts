import { v4 as uuidv4 } from 'uuid';
import { QueryVisualizationType } from '@xyne/shared';
import { GRID_COLS, DEFAULT_TILE_W, DEFAULT_TILE_H } from '../ComponentGrid/constants';
import type { ColumnKind, FilterOp, FilterRow } from './types';
import { isUnaryOp } from './validation';

export function flattenWhereToFilters(where: unknown): FilterRow[] {
  const flat: FilterRow[] = [];
  const walk = (clause: unknown): void => {
    if (!clause || typeof clause !== 'object') return;
    const c = clause as Record<string, unknown>;
    if (Array.isArray(c['AND'])) c['AND'].forEach(walk);
    else if (c['filter'] && typeof c['filter'] === 'object') {
      const f = c['filter'] as Record<string, unknown>;
      flat.push({
        id: uuidv4(),
        column: typeof f['column'] === 'string' ? f['column'] : '',
        op: (f['op'] as FilterOp) ?? 'equals',
        value:
          f['value'] === undefined || f['value'] === null
            ? ''
            : Array.isArray(f['value'])
              ? (f['value'] as unknown[]).join(',')
              : typeof f['value'] === 'string' ||
                  typeof f['value'] === 'number' ||
                  typeof f['value'] === 'boolean'
                ? String(f['value'])
                : '',
      });
    }
  };
  walk(where);
  return flat;
}

export function isIdLikeColumn(name: string): boolean {
  return /^id$|_id$/i.test(name);
}

export function filterRowToColumnFilter(
  f: FilterRow,
  col: ColumnKind | undefined,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { column: f.column, op: f.op };
  if (isUnaryOp(f.op)) return out;
  if (f.op === 'in' || f.op === 'notIn') {
    const arr = f.value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => coerceLeafValue(s, col))
      .filter((v): v is string | number | boolean => v !== undefined);
    if (arr.length === 0) return null;
    out['value'] = arr;
    return out;
  }
  const v = coerceLeafValue(f.value, col);
  if (v === undefined) return null;
  out['value'] = v;
  return out;
}

export function coerceLeafValue(
  raw: string,
  col: ColumnKind | undefined,
): string | number | boolean | undefined {
  if (!col) return raw;
  switch (col.dataTypeCanonical) {
    case 'numeric': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return undefined;
    }
    default:
      return raw;
  }
}

const DEFAULT_TILE_SIZE_BY_TYPE: Partial<Record<QueryVisualizationType, { w: number; h: number }>> =
  {
    [QueryVisualizationType.KPI]: { w: 3, h: 2 },
    [QueryVisualizationType.KPI_COMPARE]: { w: 3, h: 2 },
    [QueryVisualizationType.LINE_CHART]: { w: 8, h: 4 },
    [QueryVisualizationType.AREA_CHART]: { w: 8, h: 4 },
    [QueryVisualizationType.DATA_TABLE]: { w: 12, h: 5 },
  };

export function defaultSizeFor(visualType: QueryVisualizationType): { w: number; h: number } {
  return DEFAULT_TILE_SIZE_BY_TYPE[visualType] ?? { w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parsePosition(raw: string): Rect | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    if (
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      typeof p.w !== 'number' ||
      typeof p.h !== 'number'
    )
      return null;
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  } catch {
    return null;
  }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function nextOpenPosition(
  existingPositionStrings: ReadonlyArray<string>,
  size: { w: number; h: number },
): Rect {
  const existing = existingPositionStrings.map(parsePosition).filter((r): r is Rect => r !== null);

  const maxBottom = existing.reduce((acc, r) => Math.max(acc, r.y + r.h), 0);
  const w = Math.min(size.w, GRID_COLS);

  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const candidate: Rect = { x, y, w, h: size.h };
      if (!existing.some(r => rectsOverlap(candidate, r))) {
        return candidate;
      }
    }
  }

  return { x: 0, y: maxBottom, w, h: size.h };
}
