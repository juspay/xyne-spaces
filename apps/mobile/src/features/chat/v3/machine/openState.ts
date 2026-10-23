import type { OpenIntent } from '../intent/openIntent.types';
import type { OpenFailure } from '../types/openFailure';

/** Where the surface should land. Set at loading/placing entry; immutable until reanchor.
 * Unread is a divider in the rows, never a landing — always the last message
 * unless we are opening a named message.
 */
export type LandingTarget =
  | { kind: 'tail' }
  | { kind: 'anchor'; conversationId: string; messageId: string; createdAt: number };

export type OpenSource = 'live' | 'warm' | 'warm+live';

export type OpenState =
  | { status: 'idle' }
  | { status: 'resolving'; intent: OpenIntent; startedAt: number }
  | { status: 'loading'; intent: OpenIntent; target: LandingTarget; startedAt: number }
  | {
      status: 'placing';
      intent: OpenIntent;
      target: LandingTarget;
      source: OpenSource;
      startedAt: number;
    }
  | {
      status: 'ready';
      intent: OpenIntent;
      target: LandingTarget;
      source: OpenSource;
    }
  | { status: 'error'; intent: OpenIntent | null; failure: OpenFailure };

export type DataFacts = {
  hasPaintableRows: boolean;
  containsTarget: boolean;
  hasWarmWindow: boolean;
  warmContainsTarget: boolean;
  liveIsAuthoritative: boolean;
  expansionExhausted: boolean;
  /** Live query finished. An empty finished window is a real chat, not a miss. */
  isInitialLoadComplete: boolean;
  /** Live subscribe failed. The reducer turns this into an error, not a hang. */
  liveLoadFailed: boolean;
};

/** Placement facts reported by the list. User ownership is `userTookOwnership`. */
export type ListMetrics = {
  targetPlaced: boolean;
};

export const IDLE_STATE: OpenState = { status: 'idle' };

export const EMPTY_FACTS: DataFacts = {
  hasPaintableRows: false,
  containsTarget: false,
  hasWarmWindow: false,
  warmContainsTarget: false,
  liveIsAuthoritative: false,
  expansionExhausted: false,
  isInitialLoadComplete: false,
  liveLoadFailed: false,
};

export const initFromIntent = (intent: OpenIntent, startedAt: number): OpenState => ({
  status: 'resolving',
  intent,
  startedAt,
});

export const stateIntentKey = (state: OpenState): string | null => {
  if (state.status === 'idle') {
    return null;
  }
  return state.intent?.intentKey ?? null;
};
