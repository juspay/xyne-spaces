import { assertNever } from '../machine/assertNever';
import type { LandingTarget, OpenState } from '../machine/openState';

export type ScrollMode = 'follow-tail' | 'anchored' | 'user-owned';

export type ScrollModeEvent =
  | { type: 'userDrag' }
  | { type: 'returnedToBottom' }
  | { type: 'jumpedToTail' }
  | { type: 'retarget'; targetKind: LandingTarget['kind'] };

/** Distance from the true bottom at which we treat the user as still on the tail. */
export const TAIL_FOLLOW_THRESHOLD_PX = 24;

/** Viewport fields from `listRef.getState()` that anchoring needs. */
export type ScrollViewport = {
  contentLength: number;
  scroll: number;
  scrollLength: number;
  isAtEnd: boolean;
};

export const distanceFromBottom = (viewport: ScrollViewport): number =>
  Math.max(0, viewport.contentLength - (viewport.scroll + viewport.scrollLength));

export const shouldReturnToFollowTail = (mode: ScrollMode, isAtEnd: boolean): boolean =>
  mode === 'user-owned' && isAtEnd;

export const initialScrollMode = (target: LandingTarget): ScrollMode =>
  target.kind === 'tail' ? 'follow-tail' : 'anchored';

export const reduceScrollMode = (mode: ScrollMode, event: ScrollModeEvent): ScrollMode => {
  switch (event.type) {
    case 'userDrag':
      return 'user-owned';
    case 'returnedToBottom':
      return mode === 'user-owned' ? 'follow-tail' : mode;
    case 'jumpedToTail':
      return 'follow-tail';
    case 'retarget':
      return event.targetKind === 'tail' ? 'follow-tail' : 'anchored';
    default:
      return assertNever(event);
  }
};

/**
 * Whether LegendList should keep this row as the MVCP anchor on a data/size
 * change. Does not call `listRef.getState()` — live values are passed in.
 */
export const shouldRestorePosition = ({
  mode,
  status,
  rowId,
  lockedRowId,
  distanceFromBottomPx,
}: {
  mode: ScrollMode;
  status: OpenState['status'];
  rowId: string;
  lockedRowId: string | null;
  distanceFromBottomPx: number;
}): boolean => {
  if (status === 'idle' || status === 'error') {
    return false;
  }
  if (mode === 'follow-tail') {
    return false;
  }
  if (mode === 'user-owned') {
    return distanceFromBottomPx > TAIL_FOLLOW_THRESHOLD_PX;
  }
  return lockedRowId === null || rowId === lockedRowId;
};
