import type { DataFacts, LandingTarget, OpenState } from './openState';

export const isErrorVisible = (
  state: OpenState,
): state is Extract<OpenState, { status: 'error' }> => state.status === 'error';

const targetOf = (state: OpenState): LandingTarget | null =>
  state.status === 'loading' || state.status === 'placing' || state.status === 'ready'
    ? state.target
    : null;

/** Paint when the open can land. Anchor never paints the latest page then jumps. */
export const canPaintOpen = (state: OpenState, facts: DataFacts): boolean => {
  if (state.status === 'resolving' || state.status === 'idle') {
    return false;
  }
  const target = targetOf(state);
  if (target?.kind === 'anchor') {
    return facts.containsTarget;
  }
  return facts.hasPaintableRows;
};

export const isSkeletonVisible = (state: OpenState, facts: DataFacts): boolean =>
  state.status !== 'ready' && state.status !== 'error' && !canPaintOpen(state, facts);

export const isSurfaceVisible = (state: OpenState, facts: DataFacts): boolean =>
  state.status !== 'error' && (state.status === 'ready' || canPaintOpen(state, facts));
