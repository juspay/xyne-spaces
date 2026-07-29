import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getCalendarProvider,
  initCalendarOAuth,
  syncCalendar as requestCalendarSync,
  type CalendarProvider,
} from '../services/clients/calendarApi';
import {
  isCalendarReauthorizationError,
  parseCalendarOAuthReturn,
  type CalendarReauthCountdown,
  type CalendarSyncMessage,
} from '../utils/calendarSync';
import { logger, Logger } from '../utils/logger';

type UseCalendarSyncResult = {
  calendarProvider: CalendarProvider | null;
  isSyncing: boolean;
  syncMessage: CalendarSyncMessage | null;
  reauthCountdown: CalendarReauthCountdown | null;
  syncCalendar: () => void;
};

export function useCalendarSync(userId?: string): UseCalendarSyncResult {
  const location = useLocation();
  const navigate = useNavigate();
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calendarProvider, setCalendarProvider] = useState<CalendarProvider | null>(null);
  const [pendingAutoSync, setPendingAutoSync] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<CalendarSyncMessage | null>(null);
  const [reauthCountdown, setReauthCountdown] = useState<CalendarReauthCountdown | null>(null);

  const showTemporaryMessage = useCallback((message: CalendarSyncMessage): void => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setSyncMessage(message);
    messageTimerRef.current = setTimeout(() => {
      setSyncMessage(null);
      messageTimerRef.current = null;
    }, 3000);
  }, []);

  const performSync = useCallback(
    async (isOAuthRetry = false): Promise<void> => {
      if (!calendarProvider || isSyncing) return;

      setIsSyncing(true);
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }
      setSyncMessage(null);
      try {
        await requestCalendarSync(calendarProvider);
        showTemporaryMessage({ text: 'Synced!', ok: true });
      } catch (error) {
        if (!isOAuthRetry && isCalendarReauthorizationError(error)) {
          const isElectron = typeof window.electronAPI?.openExternal === 'function';
          try {
            const { authUrl } = await initCalendarOAuth(isElectron ? 'electron' : 'web');
            setSyncMessage({ text: '', ok: false, reauth: true });
            setReauthCountdown({ count: 5, authUrl });
          } catch (oauthError) {
            logger.error(Logger.Event.API_CALL_FAILED, {
              message: 'Failed to initialize calendar authorization',
              error: oauthError,
            });
            showTemporaryMessage({
              text: 'Unable to start calendar authorization',
              ok: false,
            });
          }
        } else {
          showTemporaryMessage({ text: 'Unable to sync', ok: false });
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [calendarProvider, isSyncing, showTemporaryMessage],
  );

  useEffect(() => {
    if (!userId) return;

    const oauthReturn = parseCalendarOAuthReturn(location.search);
    if (oauthReturn.hasResult) {
      void navigate(
        `${location.pathname}${oauthReturn.remainingSearch ? `?${oauthReturn.remainingSearch}` : ''}`,
        { replace: true },
      );
    }
    if (oauthReturn.hasError) {
      showTemporaryMessage({
        text: 'Calendar authorization failed. Please try again.',
        ok: false,
      });
    } else if (oauthReturn.shouldAutoSync) {
      setPendingAutoSync(true);
    }
  }, [location.pathname, location.search, navigate, showTemporaryMessage, userId]);

  useEffect(() => {
    if (!userId) {
      setCalendarProvider(null);
      return;
    }

    let cancelled = false;
    void getCalendarProvider()
      .then(provider => {
        if (!cancelled) setCalendarProvider(provider);
      })
      .catch((error: unknown) => {
        logger.error(Logger.Event.API_CALL_FAILED, {
          message: 'Failed to load calendar provider',
          error,
        });
        if (!cancelled) setCalendarProvider(null);
      });

    return (): void => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!pendingAutoSync || !calendarProvider) return;
    setPendingAutoSync(false);
    void performSync(true);
  }, [calendarProvider, pendingAutoSync, performSync]);

  useEffect(() => {
    if (!reauthCountdown) return;

    if (reauthCountdown.count === 0) {
      const { authUrl } = reauthCountdown;
      setReauthCountdown(null);
      setSyncMessage({
        text: 'Complete calendar authorization in your browser',
        ok: false,
        reauth: true,
      });
      if (typeof window.electronAPI?.openExternal === 'function') {
        window.electronAPI.openExternal(authUrl);
      } else {
        window.location.href = authUrl;
      }
      return;
    }

    const timer = setTimeout(() => {
      setReauthCountdown(current => (current ? { ...current, count: current.count - 1 } : null));
    }, 1000);
    return (): void => clearTimeout(timer);
  }, [reauthCountdown]);

  useEffect(
    () => (): void => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    },
    [],
  );

  return {
    calendarProvider,
    isSyncing,
    syncMessage,
    reauthCountdown,
    syncCalendar: (): void => {
      void performSync();
    },
  };
}
