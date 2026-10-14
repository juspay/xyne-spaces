import type { LandingTarget } from '../machine/openState';
import type { WarmWindow } from '../warm/warmWindow.types';
import { isAuthoritativeFor } from '../warm/isAuthoritativeFor';
import type { Conversation, ConversationWindow } from './normalizeConversationWindow';
import { windowContainsTarget } from './windowContainsTarget';

const EMPTY: readonly Conversation[] = [];
const TAIL: LandingTarget = { kind: 'tail' };

const warmLands = (warm: WarmWindow | null): boolean => warm !== null && warm.records.length > 0;

/**
 * Rows the list may paint. Live replaces warm only when it is authoritative
 * for this target (I8). A settled window with no warm cache still paints.
 */
export const conversationsForRows = (
  window: ConversationWindow,
  warm: WarmWindow | null,
  target: LandingTarget = TAIL,
): readonly Conversation[] => {
  const live = window.conversations;
  const liveCanLand = windowContainsTarget(live, target);
  const cached = warmLands(warm) ? (warm?.records as Conversation[]) : EMPTY;
  const liveIsAuthoritative = isAuthoritativeFor(
    { rows: live, isSettled: window.isInitialLoadComplete },
    warm,
    target,
  );

  if (liveCanLand && (liveIsAuthoritative || cached.length === 0)) {
    return live;
  }
  if (cached.length > 0) {
    return cached;
  }
  if (window.isInitialLoadComplete && live.length > 0) {
    return live;
  }
  if (liveCanLand) {
    return live;
  }
  return EMPTY;
};
