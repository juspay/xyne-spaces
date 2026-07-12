import { v4 as uuidv4 } from 'uuid';
import {
  QueryVisualizationType,
  defaultSizeFor,
  nextOpenPosition as sharedNextOpenPosition,
  parsePosition as sharedParsePosition,
  serializePosition,
  type GridPosition,
} from '@xyne/shared';
import { DEFAULT_TILE_W, DEFAULT_TILE_H, MIN_TILE_W, MIN_TILE_H } from '../ComponentGrid/constants';
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

// Grid geometry lives in @xyne/shared (tileLayout) so AI-placed and
// browser-placed tiles use identical math; re-exported here for existing
// import sites.
export { defaultSizeFor, serializePosition, type GridPosition };

export function defaultSizeForVisualType(visualType: string | null | undefined): {
  w: number;
  h: number;
} {
  if (!visualType) return { w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
  const enumValues = Object.values(QueryVisualizationType) as string[];
  if (enumValues.includes(visualType)) {
    return defaultSizeFor(visualType as QueryVisualizationType);
  }
  return { w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
}

// Stricter than the shared parser: additionally rejects react-grid-layout's
// default 1×1 placeholder sizes and other sub-minimum footprints.
export function parsePosition(raw: string): GridPosition | null {
  const pos = sharedParsePosition(raw);
  if (!pos || pos.w < MIN_TILE_W || pos.h < MIN_TILE_H) return null;
  return pos;
}

export function nextOpenPosition(
  existingPositionStrings: ReadonlyArray<string>,
  size: { w: number; h: number },
): GridPosition {
  // Filter through the strict parser first so placeholder-sized tiles don't
  // count as obstacles (same semantics as the previous local implementation).
  const valid = existingPositionStrings.filter(raw => parsePosition(raw) !== null);
  return sharedNextOpenPosition(valid, size);
}
