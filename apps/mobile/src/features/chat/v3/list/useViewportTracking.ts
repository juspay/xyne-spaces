import { useCallback, useRef, useState, type Dispatch } from 'react';
import type { LegendListRef } from '@legendapp/list/react-native';

import {
  distanceFromBottom,
  shouldReturnToFollowTail,
  TAIL_FOLLOW_THRESHOLD_PX,
} from './anchoring';
import type { ScrollMode, ScrollModeEvent } from './anchoring';

/**
 * Viewport tracking and the jump-to-latest affordance.
 *
 * Lives outside `ConversationList` because it is a self-contained concern:
 * read the live viewport, decide whether the user has drifted away from the
 * tail, and hand back the two callbacks the list wires to LegendList. The list
 * renders; it does not own scroll bookkeeping.
 *
 * `distanceRef` is deliberately a ref, not state — it changes every scroll frame
 * and nothing renders from it directly (C3: refs are for non-render values).
 */
export const useViewportTracking = ({
  listRef,
  modeRef,
  dispatchMode,
  onViewportScroll,
  reportLandingMetrics,
}: {
  listRef: React.RefObject<LegendListRef | null>;
  modeRef: React.RefObject<ScrollMode>;
  dispatchMode: Dispatch<ScrollModeEvent>;
  onViewportScroll: () => void;
  reportLandingMetrics: () => void;
}): {
  distanceRef: React.RefObject<number>;
  showJumpToLatest: boolean;
  syncViewport: () => boolean;
  onJumpToLatest: () => void;
} => {
  const distanceRef = useRef(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const syncViewport = useCallback((): boolean => {
    const viewport = listRef.current?.getState();
    if (!viewport) {
      return false;
    }
    distanceRef.current = distanceFromBottom(viewport);
    if (shouldReturnToFollowTail(modeRef.current, viewport.isAtEnd)) {
      dispatchMode({ type: 'returnedToBottom' });
    }
    const away =
      modeRef.current !== 'follow-tail' && distanceRef.current > TAIL_FOLLOW_THRESHOLD_PX;
    setShowJumpToLatest(prev => (prev === away ? prev : away));
    onViewportScroll();
    reportLandingMetrics();
    return true;
  }, [dispatchMode, listRef, modeRef, onViewportScroll, reportLandingMetrics]);

  const onJumpToLatest = useCallback((): void => {
    listRef.current?.scrollToEnd({ animated: true });
    dispatchMode({ type: 'jumpedToTail' });
    setShowJumpToLatest(false);
  }, [dispatchMode, listRef]);

  return { distanceRef, showJumpToLatest, syncViewport, onJumpToLatest };
};
