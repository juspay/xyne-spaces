export type BaselineWikiState = 'AVAILABLE' | 'GENERATING' | 'UNAVAILABLE';

const ACTIVE_EXECUTION_STATUSES = new Set(['NEW', 'PENDING', 'SCHEDULED', 'RUNNING']);

export function baselineWikiState(
  input: {
    executionStatus: string;
    phase: string | null;
  } | null
): BaselineWikiState {
  if (!input) return 'UNAVAILABLE';
  if (ACTIVE_EXECUTION_STATUSES.has(input.executionStatus)) return 'GENERATING';
  return input.executionStatus === 'SUCCESS' && input.phase === 'COMPLETED'
    ? 'AVAILABLE'
    : 'UNAVAILABLE';
}
