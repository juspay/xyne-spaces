import { isSameMinute } from './date-picker-draft';

export type DateUpdateDecision = 'noop' | 'reject_past' | 'apply';

/**
 * Shared Due Date / Status Deadline write gate:
 * - same minute as current → no-op
 * - new value in the past → reject
 * - otherwise → apply
 */
export function decideDateUpdate(args: {
  currentMs: number | null;
  nextMs: number | null;
  now?: number;
}): DateUpdateDecision {
  const { currentMs, nextMs, now = Date.now() } = args;
  if (nextMs === null) return 'noop';
  if (currentMs !== null && isSameMinute(currentMs, nextMs)) return 'noop';
  if (nextMs < now) return 'reject_past';
  return 'apply';
}
