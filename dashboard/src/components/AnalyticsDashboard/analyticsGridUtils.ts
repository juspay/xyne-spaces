import type { Layout, LayoutItem } from 'react-grid-layout';
import { MIN_TILE_H, MIN_TILE_W } from '../DynamicDashboard/ComponentGrid/constants';
import {
  defaultSizeForVisualType,
  nextOpenPosition,
  parsePosition,
  serializePosition,
  type GridPosition,
} from '../DynamicDashboard/componentEditor/queryPlanUtils';

export interface QueryGridEntry {
  id: string;
  position: string;
  visualType: string | null | undefined;
}

export interface BuildAnalyticsGridResult {
  layout: Layout;
  positionByQueryId: Map<string, GridPosition>;
  backfillUpdates: Array<{ id: string; position: string }>;
}

export function buildAnalyticsGridLayout(
  entries: ReadonlyArray<QueryGridEntry>,
  canEdit: boolean,
): BuildAnalyticsGridResult {
  const positionByQueryId = new Map<string, GridPosition>();
  const backfillUpdates: Array<{ id: string; position: string }> = [];
  const placedPositionStrings: string[] = [];

  for (const entry of entries) {
    const parsed = parsePosition(entry.position);
    if (parsed) {
      positionByQueryId.set(entry.id, parsed);
      placedPositionStrings.push(serializePosition(parsed));
      continue;
    }

    const size = defaultSizeForVisualType(entry.visualType);
    const pos = nextOpenPosition(placedPositionStrings, size);
    const serialized = serializePosition(pos);
    positionByQueryId.set(entry.id, pos);
    placedPositionStrings.push(serialized);
    backfillUpdates.push({ id: entry.id, position: serialized });
  }

  const layout: Layout = entries.map(entry => {
    const pos = positionByQueryId.get(entry.id)!;
    return {
      i: entry.id,
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      static: !canEdit,
      minW: MIN_TILE_W,
      minH: MIN_TILE_H,
    } satisfies LayoutItem;
  });

  return { layout, positionByQueryId, backfillUpdates };
}
