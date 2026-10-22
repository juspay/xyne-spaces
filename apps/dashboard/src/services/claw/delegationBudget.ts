export const MAX_DELEGATIONS_PER_RUN_BOUNDS = {
  MIN: 1,
  MAX: 25,
  DEFAULT: 3,
} as const;

export const MAX_DELEGATIONS_PER_RUN_OPTIONS: readonly number[] = [3, 5, 6, 8, 10, 15, 20, 25];

export function clampMaxDelegationsPerRun(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT;
  return Math.min(
    MAX_DELEGATIONS_PER_RUN_BOUNDS.MAX,
    Math.max(MAX_DELEGATIONS_PER_RUN_BOUNDS.MIN, n),
  );
}

export function delegationBudgetOptions(current: number): number[] {
  return [...new Set([...MAX_DELEGATIONS_PER_RUN_OPTIONS, current])].sort((a, b) => a - b);
}
