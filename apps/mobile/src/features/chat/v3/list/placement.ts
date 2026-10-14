import type { ChatRow } from '../model/chatRow.types';
import { keyExtractor } from '../model/rowType';
import type { LandingTarget } from '../machine/openState';
import { landingIndex } from './landing';
import { ANCHORED_VIEW_POSITION } from './legendListProps';

export type PlacementPlan =
  | { mode: 'declarative'; initialScrollIndex: { index: number; viewPosition: number } }
  | { mode: 'declarative'; initialScrollAtEnd: true }
  | { mode: 'imperative'; index: number; viewPosition: number }
  | { mode: 'none' };

export type PlacementSnapshot = {
  position?: number;
  size?: number;
  scroll: number;
  scrollLength: number;
  readyToRender: boolean;
  isAtEnd: boolean;
};

const packTail = (
  rows: readonly ChatRow[],
  isFirstMountForDataKey: boolean,
  isReanchor: boolean,
  packAtEnd: boolean,
): PlacementPlan => {
  if (isReanchor && rows.length > 0) {
    return { mode: 'imperative', index: rows.length - 1, viewPosition: 1 };
  }
  return isFirstMountForDataKey && packAtEnd
    ? { mode: 'declarative', initialScrollAtEnd: true }
    : { mode: 'none' };
};

export const placementPlan = (
  rows: readonly ChatRow[],
  target: LandingTarget | null,
  isFirstMountForDataKey: boolean,
  isReanchor: boolean,
  packAtEnd = true,
): PlacementPlan => {
  if (!target) {
    return { mode: 'none' };
  }
  if (target.kind === 'tail') {
    return packTail(rows, isFirstMountForDataKey, isReanchor, packAtEnd);
  }
  const index = landingIndex(rows, target);
  if (index === null) {
    return { mode: 'none' };
  }
  const scroll = { index, viewPosition: ANCHORED_VIEW_POSITION };
  if (isReanchor) {
    return { mode: 'imperative', ...scroll };
  }
  if (isFirstMountForDataKey) {
    return { mode: 'declarative', initialScrollIndex: scroll };
  }
  return { mode: 'none' };
};

const near = (left: number, right: number, tolerancePx: number): boolean =>
  Math.abs(left - right) <= tolerancePx;

export const isPlaced = (
  target: LandingTarget,
  snapshot: PlacementSnapshot,
  tolerancePx = 8,
): boolean => {
  if (!snapshot.readyToRender) {
    return false;
  }
  if (target.kind === 'tail') {
    return snapshot.isAtEnd;
  }
  if (snapshot.position === undefined) {
    return false;
  }
  const expected = snapshot.scroll + ANCHORED_VIEW_POSITION * snapshot.scrollLength;
  return near(snapshot.position, expected, tolerancePx);
};

export const rowKeyForTarget = (rows: readonly ChatRow[], target: LandingTarget): string | null => {
  const index = landingIndex(rows, target);
  if (index === null) {
    return null;
  }
  const row = rows[index];
  return row ? keyExtractor(row) : null;
};
