import { intentWithResolvedSurface } from '../intent/resolvedLocation';
import { assertNever } from './assertNever';
import type { OpenAction } from './openActions';
import { asError, fromFacts, hunt, loadingOf, nextSource } from './openFromFacts';
import { isLandingConfirmed, landingTargetFrom } from './revealPolicy';
import { EMPTY_FACTS, IDLE_STATE, initFromIntent, type OpenState } from './openState';
import { isStageTimedOut } from './timeouts';

type LiveAction = Exclude<OpenAction, { type: 'teardown' }>;

const keyOf = (state: OpenState): string | null =>
  state.status === 'idle' ? null : (state.intent?.intentKey ?? null);

const matches = (state: OpenState, action: OpenAction): boolean => {
  const key = keyOf(state);
  return key === null || key === action.intentKey;
};

const toReady = (state: Extract<OpenState, { status: 'placing' }>): OpenState => ({
  status: 'ready',
  intent: state.intent,
  target: state.target,
  source: state.source,
});

const reduceIdle = (action: LiveAction): OpenState => {
  switch (action.type) {
    case 'open':
      return initFromIntent(action.intent, action.now);
    case 'reanchor':
    case 'surfaceResolved':
    case 'warmWindowRead':
    case 'dataFactsChanged':
    case 'landingConfirmed':
    case 'userTookOwnership':
    case 'tick':
    case 'retry':
    case 'fail':
      return IDLE_STATE;
    default:
      return assertNever(action);
  }
};

const reduceResolving = (
  state: Extract<OpenState, { status: 'resolving' }>,
  action: LiveAction,
): OpenState => {
  switch (action.type) {
    case 'surfaceResolved': {
      const intent = intentWithResolvedSurface(state.intent, action.location.surface);
      const target = landingTargetFrom(action.location);
      return loadingOf(intent, target, state, action.now);
    }
    case 'tick':
      return state;
    case 'fail':
      return asError(state.intent, action.failure);
    case 'open':
    case 'warmWindowRead':
    case 'dataFactsChanged':
    case 'landingConfirmed':
    case 'userTookOwnership':
    case 'retry':
    case 'reanchor':
      return state;
    default:
      return assertNever(action);
  }
};

const reduceLoading = (
  state: Extract<OpenState, { status: 'loading' }>,
  action: LiveAction,
): OpenState => {
  switch (action.type) {
    case 'warmWindowRead':
      return fromFacts(
        state.intent,
        {
          ...EMPTY_FACTS,
          hasPaintableRows: action.hasRows,
          containsTarget: action.containsTarget,
          hasWarmWindow: action.hasRows,
          warmContainsTarget: action.containsTarget,
        },
        action.now,
        state,
        state.target,
      );
    case 'dataFactsChanged':
      return fromFacts(state.intent, action.facts, action.now, state, state.target);
    case 'tick':
      return state;
    case 'fail':
      return asError(state.intent, action.failure);
    case 'reanchor':
      return hunt(state.intent, action.target, action.now);
    case 'open':
    case 'surfaceResolved':
    case 'landingConfirmed':
    case 'userTookOwnership':
    case 'retry':
      return state;
    default:
      return assertNever(action);
  }
};

const reducePlacing = (
  state: Extract<OpenState, { status: 'placing' }>,
  action: LiveAction,
): OpenState => {
  switch (action.type) {
    case 'landingConfirmed':
      return isLandingConfirmed(state.target, action.metrics) ? toReady(state) : state;
    case 'userTookOwnership':
      return toReady(state);
    case 'tick':
      return isStageTimedOut(state, action.now) ? toReady(state) : state;
    case 'dataFactsChanged': {
      const next = fromFacts(state.intent, action.facts, action.now, state, state.target);
      if (next.status === 'loading') {
        return { ...state, source: nextSource(state.source, action.facts) };
      }
      if (next.status === 'placing') {
        return { ...next, target: state.target, startedAt: state.startedAt };
      }
      return next;
    }
    case 'fail':
      return asError(state.intent, action.failure);
    case 'reanchor':
      return hunt(state.intent, action.target, action.now);
    case 'open':
    case 'surfaceResolved':
    case 'warmWindowRead':
    case 'retry':
      return state;
    default:
      return assertNever(action);
  }
};

const reduceReady = (
  state: Extract<OpenState, { status: 'ready' }>,
  action: LiveAction,
): OpenState => {
  switch (action.type) {
    case 'reanchor':
      return hunt(state.intent, action.target, action.now);
    case 'dataFactsChanged':
      return { ...state, source: nextSource(state.source, action.facts) };
    case 'fail':
      return asError(state.intent, action.failure);
    case 'open':
    case 'surfaceResolved':
    case 'warmWindowRead':
    case 'landingConfirmed':
    case 'userTookOwnership':
    case 'tick':
    case 'retry':
      return state;
    default:
      return assertNever(action);
  }
};

const reduceError = (
  state: Extract<OpenState, { status: 'error' }>,
  action: LiveAction,
): OpenState => {
  switch (action.type) {
    case 'open':
      return initFromIntent(action.intent, action.now);
    case 'retry':
      return state.intent ? initFromIntent(state.intent, action.now) : state;
    case 'reanchor':
      return state.intent ? hunt(state.intent, action.target, action.now) : state;
    case 'surfaceResolved':
    case 'warmWindowRead':
    case 'dataFactsChanged':
    case 'landingConfirmed':
    case 'userTookOwnership':
    case 'tick':
    case 'fail':
      return state;
    default:
      return assertNever(action);
  }
};

export const openReducer = (state: OpenState, action: OpenAction): OpenState => {
  if (action.type === 'teardown') {
    if (state.status === 'idle') {
      return state;
    }
    return matches(state, action) ? IDLE_STATE : state;
  }
  if (!matches(state, action) && action.type !== 'open') {
    return state;
  }
  switch (state.status) {
    case 'idle':
      return reduceIdle(action);
    case 'resolving':
      return reduceResolving(state, action);
    case 'loading':
      return reduceLoading(state, action);
    case 'placing':
      return reducePlacing(state, action);
    case 'ready':
      return reduceReady(state, action);
    case 'error':
      return reduceError(state, action);
    default:
      return assertNever(state);
  }
};
