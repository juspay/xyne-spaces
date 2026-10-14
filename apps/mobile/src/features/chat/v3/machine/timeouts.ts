import type { OpenState } from './openState';

export const STAGE_BUDGET_MS = {
  resolving: 4_000,
  loading: 8_000,
  placing: 1_500,
} as const;

export const budgetFor = (status: OpenState['status']): number | null => {
  if (status === 'resolving' || status === 'loading' || status === 'placing') {
    return STAGE_BUDGET_MS[status];
  }
  return null;
};

export const isStageTimedOut = (state: OpenState, now: number): boolean => {
  const budget = budgetFor(state.status);
  if (
    budget === null ||
    state.status === 'idle' ||
    state.status === 'ready' ||
    state.status === 'error'
  ) {
    return false;
  }
  return now - state.startedAt >= budget;
};
