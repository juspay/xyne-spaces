import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { NotificationType, type TranscriptTranslation } from '@xyne/shared';
import { recordingService } from '../services/Recording/recordingService';
import { websocketService } from '../services/clients/socketClient';
import { logRecordingError } from '../utils/recordingUtils';

interface TranslationReadyEvent {
  notification: {
    type: NotificationType;
    metadata?: { callExternalId?: string; language?: string };
    data?: { callExternalId?: string; language?: string };
  };
}

export interface UseTranscriptTranslationOptions {
  externalId: string | undefined;
  language: string;
  enabled: boolean;
}

export interface UseTranscriptTranslationResult {
  text: string | undefined;
  isLoading: boolean;
  isTranslating: boolean;
  error: string | undefined;
  retry: () => void;
}

/**
 * Fetches a call's transcript text in the selected language for display (e.g. in
 * TranscriptSidePanel). `original` returns the stored transcript as-is; any other
 * language is translated server-side, and the hook refetches once notified it's ready.
 * Local state only — transcript text is never synced through Zero.
 */
export function useTranscriptTranslation({
  externalId,
  language,
  enabled,
}: UseTranscriptTranslationOptions): UseTranscriptTranslationResult {
  const cacheRef = useRef<Record<string, TranscriptTranslation>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [translatingLanguage, setTranslatingLanguage] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState<TranscriptTranslation | undefined>(undefined);

  useEffect(() => {
    cacheRef.current = {};
    setErrors({});
    setTranslatingLanguage(null);
    setDisplayed(undefined);
  }, [externalId]);

  // A failed language never auto-retries — retry() clears the error, which refires this effect.
  const currentError = errors[language];

  useEffect(() => {
    if (!enabled || !externalId) return;

    const cached = cacheRef.current[language];
    if (cached?.status === 'ready' && cached.text !== undefined) {
      setDisplayed(cached);
      return;
    }
    if (currentError !== undefined) return;

    let cancelled = false;

    const fetchOnce = (): void => {
      void recordingService
        .translateTranscript(externalId, language)
        .then(result => {
          if (cancelled) return;
          cacheRef.current = { ...cacheRef.current, [language]: result };

          if (result.status === 'pending') {
            setTranslatingLanguage(language);
            return;
          }

          setDisplayed(result);
          setTranslatingLanguage(current => (current === language ? null : current));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          logRecordingError('useTranscriptTranslation', err);
          const message = axios.isAxiosError(err)
            ? (err.response?.data as { error?: string } | undefined)?.error
            : undefined;
          setErrors(current => ({ ...current, [language]: message ?? 'Please try again.' }));
          setTranslatingLanguage(current => (current === language ? null : current));
        });
    };

    fetchOnce();

    const onNotification = (event: TranslationReadyEvent): void => {
      if (event.notification.type !== NotificationType.TRANSCRIPT_TRANSLATION_READY) return;
      const ids = { ...event.notification.metadata, ...event.notification.data };
      if (ids.callExternalId !== externalId || ids.language !== language) return;
      fetchOnce();
    };
    websocketService.on('notification_received', onNotification);

    return (): void => {
      cancelled = true;
      websocketService.removeListener('notification_received', onNotification);
    };
  }, [enabled, externalId, language, currentError]);

  const retry = useCallback((): void => {
    setErrors(current => {
      if (!(language in current)) return current;
      const { [language]: _removed, ...rest } = current;
      return rest;
    });
  }, [language]);

  return {
    text: displayed?.text,
    isLoading:
      enabled && !!externalId && displayed?.text === undefined && currentError === undefined,
    isTranslating: translatingLanguage === language,
    error: currentError,
    retry,
  };
}
