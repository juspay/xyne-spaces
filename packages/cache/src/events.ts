/**
 * Everything a cache reports. The package emits; the consumer decides what is
 * a log line and what is a metric. One variant per outcome, trigger as data.
 */
export type RefreshTrigger = 'init' | 'interval' | 'manual';

export type CacheEvent =
  | { type: 'refresh'; name: string; size: number; durationMs: number; trigger: RefreshTrigger }
  | { type: 'refresh-failed'; name: string; error: unknown; durationMs: number; trigger: RefreshTrigger }
  | { type: 'stop'; name: string };
