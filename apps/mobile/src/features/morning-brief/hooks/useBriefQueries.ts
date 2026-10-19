import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  dailyBriefApi,
  type DailyBriefConfig,
  type DailyBriefDate,
  type DailyBriefHistoryItem,
  type DailyBriefLatest,
} from '../api/dailyBriefApi';

/** Today's brief plus the previous seven; older dates fetch on demand. */
export const BRIEF_HISTORY_LIMIT = 7;

/** Matches the web's 10s quiet reload while a generation is in flight. */
export const BRIEF_POLL_INTERVAL_MS = 10_000;

export const briefKeys = {
  all: ['daily-brief'] as const,
  latest: () => [...briefKeys.all, 'latest'] as const,
  history: (limit: number) => [...briefKeys.all, 'history', limit] as const,
  dates: () => [...briefKeys.all, 'dates'] as const,
  byDate: (date: string) => [...briefKeys.all, 'by-date', date] as const,
  config: () => [...briefKeys.all, 'config'] as const,
};

/**
 * Latest brief. Polls every 10s while a generation is in flight — either the
 * stored row says `generating`, or the caller knows a regenerate request is
 * running (`pollWhileGenerating`).
 */
export function useLatestBrief(pollWhileGenerating: boolean): UseQueryResult<DailyBriefLatest> {
  return useQuery({
    queryKey: briefKeys.latest(),
    queryFn: () => dailyBriefApi.getLatest(),
    staleTime: 30_000,
    refetchInterval: query =>
      pollWhileGenerating || query.state.data?.status === 'generating'
        ? BRIEF_POLL_INTERVAL_MS
        : false,
  });
}

export function useBriefHistory(): UseQueryResult<DailyBriefHistoryItem[]> {
  return useQuery({
    queryKey: briefKeys.history(BRIEF_HISTORY_LIMIT),
    queryFn: () => dailyBriefApi.getHistory(BRIEF_HISTORY_LIMIT),
    staleTime: 30_000,
  });
}

export function useBriefDates(): UseQueryResult<DailyBriefDate[]> {
  return useQuery({
    queryKey: briefKeys.dates(),
    queryFn: () => dailyBriefApi.getDates(),
    staleTime: 30_000,
  });
}

/** A brief outside the loaded history window, pulled in by the date picker. */
export function useBriefByDate(date: string | null): UseQueryResult<DailyBriefLatest> {
  return useQuery({
    queryKey: briefKeys.byDate(date ?? 'none'),
    queryFn: () => dailyBriefApi.getByDate(date ?? ''),
    enabled: date !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBriefConfig(): UseQueryResult<DailyBriefConfig> {
  return useQuery({
    queryKey: briefKeys.config(),
    queryFn: () => dailyBriefApi.getConfig(),
    staleTime: 60_000,
  });
}
