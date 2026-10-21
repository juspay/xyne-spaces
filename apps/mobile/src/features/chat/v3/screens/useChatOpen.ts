import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { conversationRefFor } from '../data/conversationRef';
import type { ConversationWindow } from '../data/normalizeConversationWindow';
import { useConversationWindow } from '../data/useConversationWindow';
import { useDataFacts } from '../data/useDataFacts';
import type { OpenIntent } from '../intent/openIntent.types';
import type { ResolvedLocation } from '../intent/resolvedLocation';
import { landingKeyForLocation } from '../intent/resolvedLocation';
import { useExpandTowardTarget } from '../list/useExpandTowardTarget';
import { targetFromState } from '../list/landing';
import {
  classifyOpen,
  isWeakerLanding,
  landingTargetFrom,
  resolvedLocationForOpen,
} from '../machine/revealPolicy';
import type { OpenAction } from '../machine/openActions';
import { openReducer } from '../machine/openReducer';
import { initFromIntent, type OpenState } from '../machine/openState';
import { budgetFor } from '../machine/timeouts';
import {
  createOpenTrace,
  recordOutcome,
  recordTransition,
  recordWarmDecision,
  shouldSampleOpenTrace,
  type OpenTrace,
} from '../observability/openTrace';
import { CHAT_OPEN_DEFERRAL_MS, acquireDeferral } from '../scheduling/deferral';
import { hydratePersistedWindow } from '../warm/hydratePersistedWindow';
import { productionWarmDeps } from '../warm/productionWarm';
import { readWarmWindow, warmWindowAction } from '../warm/readWarmWindow';
import type { WarmWindow } from '../warm/warmWindow.types';
import type { Result } from '../intent/openIntent.types';
import type { OpenFailure } from '../types/openFailure';

const startTrace = (intent: OpenIntent, warmWindow: WarmWindow | null): OpenTrace => {
  const at = Date.now();
  let trace = createOpenTrace({
    intentKey: intent.intentKey,
    entry: intent.entry,
    isColdStart: intent.isColdStart,
    raw: intent.raw,
    sampled: shouldSampleOpenTrace({ isDev: __DEV__, isBetaUser: false }),
  });
  if (warmWindow) {
    trace = recordWarmDecision(trace, {
      containsTarget: warmWindow.containsTarget,
      fingerprint: warmWindow.fingerprint,
      ageMs: Math.max(0, at - warmWindow.readAt),
      at,
    });
  }
  return trace;
};

/**
 * One open: resolve location, then warm snapshot, reducer.
 * Effects only for the machine, one stage timeout, and a teardown token (C4).
 * List subscribe is `useChatOpenWindow`, mounted after `aroundCursorFor` is known.
 */
export const useChatOpen = (
  intent: OpenIntent,
  location: Result<ResolvedLocation, OpenFailure> | null,
): {
  state: OpenState;
  dispatch: (action: OpenAction) => void;
  ref: ReturnType<typeof conversationRefFor>;
  warmWindow: WarmWindow | null;
  target: ReturnType<typeof classifyOpen>;
} => {
  const [warmWindow] = useState<WarmWindow | null>(() => {
    hydratePersistedWindow(intent);
    return readWarmWindow(intent, productionWarmDeps());
  });
  const [state, rawDispatch] = useReducer(openReducer, intent, (initialIntent): OpenState =>
    initFromIntent(initialIntent, Date.now()),
  );
  const locationKeySeen = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const traceRef = useRef<OpenTrace | null>(null);
  if (traceRef.current === null) {
    traceRef.current = startTrace(intent, warmWindow);
  }

  const dispatch = useCallback((action: OpenAction): void => {
    const previous = stateRef.current;
    const next = openReducer(previous, action);
    stateRef.current = next;
    const at = Date.now();
    const current = traceRef.current;
    if (current) {
      let trace = recordTransition(current, previous.status, next.status, action.type, at);
      if (next.status === 'ready' || next.status === 'error' || next.status === 'idle') {
        trace = recordOutcome(
          trace,
          next.status,
          at,
          next.status === 'error' ? next.failure : undefined,
        );
      }
      traceRef.current = trace;
    }
    rawDispatch(action);
  }, []);

  const target = targetFromState(state) ?? classifyOpen(intent);

  useEffect(() => {
    if (state.status === 'idle') {
      dispatch({ type: 'open', intent, now: Date.now(), intentKey: intent.intentKey });
      return;
    }
    if (location !== null && !location.ok) {
      dispatch({ type: 'fail', failure: location.error, intentKey: intent.intentKey });
      return;
    }
    if (state.status === 'resolving') {
      const resolved = resolvedLocationForOpen(intent, location);
      if (!resolved) {
        return;
      }
      locationKeySeen.current = landingKeyForLocation(resolved);
      dispatch({
        type: 'surfaceResolved',
        location: resolved,
        now: Date.now(),
        intentKey: intent.intentKey,
      });
      if (warmWindow) {
        dispatch(warmWindowAction(intent, warmWindow, Date.now()));
      }
      return;
    }
    if (location?.ok === true) {
      const locationKey = landingKeyForLocation(location.value);
      if (locationKeySeen.current !== locationKey && state.status !== 'error') {
        locationKeySeen.current = locationKey;
        const nextTarget = landingTargetFrom(location.value);
        const currentTarget = targetFromState(state);
        if (!currentTarget || !isWeakerLanding(currentTarget, nextTarget)) {
          dispatch({
            type: 'reanchor',
            target: nextTarget,
            now: Date.now(),
            intentKey: intent.intentKey,
          });
        }
      }
    }
  }, [dispatch, intent, location, state.status, warmWindow]);

  const status = state.status;
  const startedAt =
    state.status === 'resolving' || state.status === 'loading' || state.status === 'placing'
      ? state.startedAt
      : 0;

  useEffect(() => {
    const budget = budgetFor(status);
    if (budget === null) {
      return;
    }
    const delay = Math.max(0, budget - (Date.now() - startedAt));
    const intentKey = intent.intentKey;
    const id = setTimeout((): void => {
      dispatch({ type: 'tick', now: Date.now(), intentKey });
    }, delay);
    return (): void => clearTimeout(id);
  }, [dispatch, intent.intentKey, startedAt, status]);

  useEffect(() => {
    const token = acquireDeferral('chat-open', CHAT_OPEN_DEFERRAL_MS);
    const intentKey = intent.intentKey;
    return (): void => {
      token.release();
      dispatch({ type: 'teardown', intentKey });
    };
  }, [dispatch, intent.intentKey]);

  return {
    state,
    dispatch,
    ref: conversationRefFor(intent),
    warmWindow,
    target,
  };
};

export type ChatOpenSession = ReturnType<typeof useChatOpen>;

/** List query + facts. Mounted only when `aroundCursorFor` is known for anchors. */
export const useChatOpenWindow = (
  intent: OpenIntent,
  target: ReturnType<typeof classifyOpen>,
  state: OpenState,
  dispatch: (action: OpenAction) => void,
  warmWindow: WarmWindow | null,
): ConversationWindow => {
  const window = useConversationWindow(intent, target);
  const facts = useDataFacts(window, target, warmWindow);
  const factsSeen = useRef<ReturnType<typeof useDataFacts> | null>(null);

  useExpandTowardTarget({
    status: state.status,
    target,
    containsTarget: facts.containsTarget,
    isInitialLoadComplete: window.isInitialLoadComplete,
    hasReachedStart: window.hasReachedStart,
    conversations: window.conversations,
    loadOlder: window.loadOlder,
    loadNewer: window.loadNewer,
  });

  useEffect(() => {
    if (state.status === 'error') {
      factsSeen.current = null;
      return;
    }
    if (state.status !== 'loading' && state.status !== 'placing' && state.status !== 'ready') {
      return;
    }
    if (factsSeen.current === facts) {
      return;
    }
    factsSeen.current = facts;
    dispatch({
      type: 'dataFactsChanged',
      facts,
      now: Date.now(),
      intentKey: intent.intentKey,
    });
  }, [dispatch, facts, intent.intentKey, state.status]);

  return window;
};
