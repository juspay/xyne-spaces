import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { refreshAuthSession } from '@/src/services/AuthServices';
import {
  getAuthRetryDelay,
  getMsUntilProactiveRefresh,
  getProactiveRearmDelay,
} from '@/src/services/sessionTokenPolicy';
import { Event, logger } from '@/src/utils/logger';
import { getAuthOperation, getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';

/**
 * Refreshes the session JWT before `exp` so Zero and the API never see an
 * expired token. Best-effort: it retries with backoff but never signs the user
 * out — that stays with the `needs-auth` recovery path.
 */
export function useSessionTokenKeepAlive(
  token: string | null,
  workspaceId: string | null,
  applyRefreshedToken: (token: string, generation?: number, operation?: number) => Promise<boolean>,
): void {
  const applyRefreshedTokenRef = useRef(applyRefreshedToken);
  applyRefreshedTokenRef.current = applyRefreshedToken;
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  useEffect(() => {
    const delayMs = token === null ? null : getMsUntilProactiveRefresh(token);
    if (token === null || delayMs === null) {
      return;
    }

    let cancelled = false;
    const generation = getAuthSessionGeneration();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (nextDelayMs: number): void => {
      if (cancelled) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, nextDelayMs);
    };

    const refresh = async (): Promise<void> => {
      const operation = getAuthOperation();
      try {
        const result = await refreshAuthSession(
          workspaceIdRef.current ?? undefined,
          generation,
          operation,
        );
        if (cancelled) {
          return;
        }
        if (result.ok) {
          // A new token re-runs this effect and arms the next timer. Re-arm here
          // too so an unchanged token string cannot silently end the keep-alive.
          const rearm = getProactiveRearmDelay(result.token, attempt);
          attempt = rearm.stillDue ? attempt + 1 : 0;
          schedule(rearm.delayMs);
          await applyRefreshedTokenRef.current(result.token, generation, operation);
          return;
        }
        logger.warn(Event.LOTUS_AUTH_CHECK, {
          stage: 'proactive_token_refresh_failed',
          reason: result.kind,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        logger.warn(Event.LOTUS_AUTH_CHECK, { stage: 'proactive_token_refresh_exception', error });
      }
      schedule(getAuthRetryDelay(attempt));
      attempt += 1;
    };

    schedule(delayMs);

    const subscription = AppState.addEventListener('change', nextAppState => {
      // Timers do not fire while the app is suspended, so a backgrounded app can
      // come back with the refresh already overdue.
      if (nextAppState === 'active' && getMsUntilProactiveRefresh(token) === 0) {
        void refresh();
      }
    });

    return (): void => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
  }, [token]);
}
