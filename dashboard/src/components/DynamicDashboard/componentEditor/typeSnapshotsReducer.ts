import type { QueryVisualizationType } from '@xyne/shared';
import type { GroupByRow, MeasureRow, OrderByRow } from './types';

export interface TypeSnapshotEntry {
  measures: MeasureRow[];
  groupBy: GroupByRow[];
  orderBy: OrderByRow[];
  selectCols: string[];
}

export interface TypeSnapshotsState {
  snapshots: Partial<Record<QueryVisualizationType, TypeSnapshotEntry>>;
  visited: Set<QueryVisualizationType>;
}

export type TypeSnapshotsAction =
  | { type: 'reset'; visualType: QueryVisualizationType }
  | {
      type: 'snapshotAndVisit';
      from: QueryVisualizationType;
      to: QueryVisualizationType;
      snapshot: TypeSnapshotEntry;
    };

export function initialTypeSnapshots(visualType: QueryVisualizationType): TypeSnapshotsState {
  return { snapshots: {}, visited: new Set([visualType]) };
}

export function typeSnapshotsReducer(
  state: TypeSnapshotsState,
  action: TypeSnapshotsAction,
): TypeSnapshotsState {
  switch (action.type) {
    case 'reset':
      return { snapshots: {}, visited: new Set([action.visualType]) };
    case 'snapshotAndVisit': {
      if (action.from === action.to && state.visited.has(action.from)) {
        return state;
      }
      const visited = new Set(state.visited);
      visited.add(action.from);
      visited.add(action.to);
      return {
        snapshots: { ...state.snapshots, [action.from]: action.snapshot },
        visited,
      };
    }
    default: {
      action satisfies never;
      return state;
    }
  }
}
