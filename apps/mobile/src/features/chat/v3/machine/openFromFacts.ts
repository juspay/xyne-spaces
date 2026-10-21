import type { OpenIntent } from '../intent/openIntent.types';
import type { OpenFailure } from '../types/openFailure';
import type { DataFacts, LandingTarget, OpenSource, OpenState } from './openState';

export const asError = (intent: OpenIntent | null, failure: OpenFailure): OpenState => ({
  status: 'error',
  intent,
  failure,
});

export const nextSource = (current: OpenSource | null, facts: DataFacts): OpenSource => {
  if (!facts.liveIsAuthoritative) {
    return current === 'live' ? 'live' : 'warm';
  }
  if (current === 'warm') {
    return 'warm+live';
  }
  return 'live';
};

export const placingOf = (
  intent: OpenIntent,
  target: LandingTarget,
  previous: OpenState,
  facts: DataFacts,
  now: number,
): OpenState => ({
  status: 'placing',
  intent,
  target,
  source: nextSource(
    previous.status === 'placing' || previous.status === 'ready' ? previous.source : null,
    facts,
  ),
  startedAt: previous.status === 'placing' ? previous.startedAt : now,
});

export const loadingOf = (
  intent: OpenIntent,
  target: LandingTarget,
  previous: OpenState,
  now: number,
): OpenState => ({
  status: 'loading',
  intent,
  target,
  startedAt: previous.status === 'loading' ? previous.startedAt : now,
});

const readyOf = (
  intent: OpenIntent,
  target: LandingTarget,
  previous: OpenState,
  facts: DataFacts,
): OpenState => ({
  status: 'ready',
  intent,
  target,
  source: nextSource(
    previous.status === 'placing' || previous.status === 'ready' ? previous.source : null,
    facts,
  ),
});

const lockedTarget = (state: OpenState, fallback: LandingTarget): LandingTarget =>
  state.status === 'loading' || state.status === 'placing' || state.status === 'ready'
    ? state.target
    : fallback;

export const fromFacts = (
  intent: OpenIntent,
  facts: DataFacts,
  now: number,
  previous: OpenState,
  fallback: LandingTarget,
): OpenState => {
  const target = lockedTarget(previous, fallback);
  if (facts.liveLoadFailed) {
    const canLand = facts.hasPaintableRows && (target.kind !== 'anchor' || facts.containsTarget);
    if (!canLand) {
      return asError(intent, { reason: 'live-error' });
    }
  }
  if (
    target.kind === 'anchor' &&
    facts.isInitialLoadComplete &&
    facts.expansionExhausted &&
    facts.liveIsAuthoritative &&
    !facts.containsTarget
  ) {
    return asError(intent, { reason: 'anchor-unreachable' });
  }
  if (target.kind === 'anchor' && !facts.containsTarget) {
    return loadingOf(intent, target, previous, now);
  }
  if (!facts.hasPaintableRows) {
    if (facts.isInitialLoadComplete) {
      return readyOf(intent, target, previous, facts);
    }
    return loadingOf(intent, target, previous, now);
  }
  return placingOf(intent, target, previous, facts, now);
};

export const hunt = (intent: OpenIntent, target: LandingTarget, now: number): OpenState => ({
  status: 'loading',
  intent,
  target,
  startedAt: now,
});
