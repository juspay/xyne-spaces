import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { isMtlsRequestError } from '@/src/services/apiClient';

import { dailyBriefApi } from '../api/dailyBriefApi';
import { parseBriefSse } from '../api/parseBriefSse';
import { briefKeys } from './useBriefQueries';

export interface RegenerateState {
  regenerating: boolean;
  /** Static label while the buffered request runs (no live SSE on mobile). */
  progress: string | null;
  error: string | null;
  clearError: () => void;
  /** 'pending' = the request died but the run is still going; the poll owns it. */
  regenerate: () => Promise<'ready' | 'failed' | 'pending'>;
}

/**
 * Kick off a brief regeneration and wait for the buffered SSE body.
 *
 * The mTLS transport cannot stream, so the request resolves only when the run
 * finishes (or the transport gives up). While it runs, useLatestBrief keeps
 * polling `/latest` — the backend marks the row `generating` immediately — so
 * even a transport timeout ends in the poll picking up the finished brief.
 * That is why a failed REQUEST with a row still generating is not surfaced as
 * a failure here.
 */
export function useRegenerateBrief(): RegenerateState {
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: briefKeys.all });
  }, [queryClient]);

  const regenerate = useCallback(async (): Promise<'ready' | 'failed' | 'pending'> => {
    if (mountedRef.current) {
      setRegenerating(true);
      setError(null);
    }
    // Make the `generating` row visible right away so other surfaces (and the
    // poll) reflect the run without waiting for the long request.
    const kickoffRefresh = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: briefKeys.latest() });
    }, 1500);

    try {
      const { data } = await dailyBriefApi.regenerate();
      const result = parseBriefSse(data);
      if (result.error && !result.sawComplete) {
        if (mountedRef.current) setError(result.error);
        return 'failed';
      }
      // No `complete` frame means the buffered body ended early (truncated
      // stream, or the transport resolved without a full run). The run may
      // well still be going server-side — hand the UX to the poll instead of
      // announcing a brief that isn't there.
      return result.sawComplete ? 'ready' : 'pending';
    } catch (err) {
      // The transport can give up on a long-running request while the run is
      // still going server-side. Check the stored row before calling it a
      // failure — if it is `generating` or already `ready`, the poll owns the
      // rest of the UX.
      try {
        const latest = await dailyBriefApi.getLatest();
        if (latest.status === 'ready' && latest.isToday) return 'ready';
        if (latest.status === 'generating') return 'pending';
      } catch {
        // fall through to the error below
      }
      const message = isMtlsRequestError(err)
        ? 'Regeneration failed.'
        : err instanceof Error && err.message
          ? err.message
          : 'Regeneration failed.';
      if (mountedRef.current) setError(message);
      return 'failed';
    } finally {
      clearTimeout(kickoffRefresh);
      await invalidateAll();
      if (mountedRef.current) setRegenerating(false);
    }
  }, [invalidateAll, queryClient]);

  return {
    regenerating,
    progress: regenerating ? 'Generating…' : null,
    error,
    clearError: useCallback(() => setError(null), []),
    regenerate,
  };
}
