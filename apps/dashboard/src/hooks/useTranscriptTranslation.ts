import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { TranscriptTranslation } from '@xyne/shared';
import { recordingService } from '../services/Recording/recordingService';
import { logRecordingError } from '../utils/recordingUtils';

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
  const cacheRef = useRef<Map<string, TranscriptTranslation>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [translatingLanguage, setTranslatingLanguage] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState<TranscriptTranslation | undefined>(undefined);

  useEffect(() => {
    cacheRef.current = new Map();
    setErrors(new Map());
    setTranslatingLanguage(null);
    setDisplayed(undefined);
  }, [externalId]);

  // A failed language never auto-retries — retry() clears the error, which refires this effect.
  const currentError = errors.get(language);

  useEffect(() => {
    if (!enabled || !externalId) return;

    const cached = cacheRef.current.get(language);
    if (cached?.status === 'ready' && cached.text !== undefined) {
      setDisplayed(cached);
      return;
    }
    if (currentError !== undefined) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const POLL_INTERVAL_MS = 3000;

    const fetchStatus = (): void => {
      void recordingService
        .translateTranscript(externalId, language)
        .then(result => {
          if (cancelled) return;
          cacheRef.current.set(language, result);

          if (result.status === 'pending') {
            setTranslatingLanguage(language);
            timeoutId = setTimeout(fetchStatus, POLL_INTERVAL_MS);
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
          setErrors(current => new Map(current).set(language, message ?? 'Please try again.'));
          setTranslatingLanguage(current => (current === language ? null : current));
        });
    };
    fetchStatus();

    return (): void => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [enabled, externalId, language, currentError]);

  const retry = useCallback((): void => {
    setErrors(current => {
      if (!current.has(language)) return current;
      const next = new Map(current);
      next.delete(language);
      return next;
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
