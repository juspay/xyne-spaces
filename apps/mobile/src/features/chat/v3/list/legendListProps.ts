import type { ChatRow } from '../model/chatRow.types';
import { DATE_ROW_HEIGHT, UNREAD_DIVIDER_HEIGHT } from '../model/measureRowHeight';
import { rowsAreEqual } from '../model/rowEquals';
import { getRowType, keyExtractor } from '../model/rowType';
import type { LandingTarget, OpenState } from '../machine/openState';
import { stateIntentKey } from '../machine/openState';
import { intentKeyFor, type OpenSurface } from '../intent/openIntent.types';
import { placementPlan } from './placement';

/**
 * LegendList caps the initial visible-first allocation to 50 px internally,
 * then expands to this configured distance after `readyToRender`.
 */
export const DRAW_DISTANCE = 250;

/** First-frame allocation hint. P5 reserved heights are the fixed sizes. */
export const ESTIMATED_ROW_HEIGHT = 72;

export const ANCHORED_VIEW_POSITION = 0.35;

export const PAGINATION_THRESHOLD = 1.5;

const MAINTAIN_SCROLL_AT_END_CHANNEL = {
  animated: true,
  on: { dataChange: true, itemLayout: true, layout: true },
} as const;

const MAINTAIN_SCROLL_AT_END_THREAD = {
  animated: true,
  on: { dataChange: false, itemLayout: true, layout: true },
} as const;

export const intentKeyFrom = (state: OpenState, surface: OpenSurface): string =>
  stateIntentKey(state) ?? intentKeyFor(surface);

/**
 * Only rows whose height is intrinsically exact belong here. Message rows
 * contain rich text, previews, reactions, and expandable content; LegendList
 * must measure those rows instead of treating a model estimate as a hard
 * height.
 */
export const getFixedRowSize = (item: ChatRow): number | undefined => {
  if (item.type === 'date') {
    return DATE_ROW_HEIGHT;
  }
  if (item.type === 'unread-divider') {
    return UNREAD_DIVIDER_HEIGHT;
  }
  return undefined;
};

export type LegendListConfig = {
  data: readonly ChatRow[];
  dataKey: string;
  alignItemsAtEnd: boolean;
  recycleItems: true;
  estimatedItemSize: number;
  drawDistance: number;
  initialScrollAtEnd: boolean;
  initialScrollIndex?: { index: number; viewPosition: number };
  keyExtractor: (item: ChatRow) => string;
  getItemType: (item: ChatRow) => string;
  getFixedItemSize: (item: ChatRow) => number | undefined;
  itemsAreEqual: (previous: ChatRow, next: ChatRow) => boolean;
  maintainScrollAtEnd: {
    animated: true;
    on: { dataChange: boolean; itemLayout: true; layout: true };
  };
  maintainScrollAtEndThreshold: number;
  maintainVisibleContentPosition: {
    data: true;
    size: true;
    shouldRestorePosition: (item: ChatRow, index: number, data: readonly ChatRow[]) => boolean;
  };
  onStartReachedThreshold: number;
  onEndReachedThreshold: number;
};

export const legendListProps = ({
  state,
  surface,
  target,
  rows,
  shouldRestorePosition,
}: {
  state: OpenState;
  surface: OpenSurface;
  target: LandingTarget | null;
  rows: readonly ChatRow[];
  shouldRestorePosition: (item: ChatRow, index: number, data: readonly ChatRow[]) => boolean;
}): LegendListConfig => {
  const isThreadSurface = surface.kind !== 'channel';
  const followTail = target?.kind === 'tail';
  const plan = placementPlan(rows, target, true, false, followTail && !isThreadSurface);
  const initialScrollAtEnd = plan.mode === 'declarative' && 'initialScrollAtEnd' in plan;
  const dataKey = intentKeyFrom(state, surface);
  return {
    data: rows,
    dataKey,
    alignItemsAtEnd: followTail && !isThreadSurface,
    recycleItems: true,
    estimatedItemSize: ESTIMATED_ROW_HEIGHT,
    drawDistance: DRAW_DISTANCE,
    initialScrollAtEnd,
    keyExtractor,
    getItemType: getRowType,
    getFixedItemSize: getFixedRowSize,
    itemsAreEqual: rowsAreEqual,
    maintainScrollAtEnd:
      followTail && !isThreadSurface
        ? MAINTAIN_SCROLL_AT_END_CHANNEL
        : MAINTAIN_SCROLL_AT_END_THREAD,
    maintainScrollAtEndThreshold: 0.1,
    maintainVisibleContentPosition: {
      data: true,
      size: true,
      shouldRestorePosition,
    },
    onStartReachedThreshold: PAGINATION_THRESHOLD,
    onEndReachedThreshold: PAGINATION_THRESHOLD,
    ...(plan.mode === 'declarative' && 'initialScrollIndex' in plan
      ? { initialScrollIndex: plan.initialScrollIndex }
      : {}),
  };
};
