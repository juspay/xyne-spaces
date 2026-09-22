import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { TranscriptTranslation } from '@xyne/shared';
import { recordingService } from '../services/Recording/recordingService';
import { logRecordingError } from '../utils/recordingUtils';

const TRANSLATION_POLL_INTERVAL_MS = 3000;
const TRANSLATION_POLL_MAX_ATTEMPTS = 40; // ~2 minutes

export interface UseTranscriptTranslationOptions {
  externalId: string | undefined;
  language: string;
  enabled: boolean;
}

export interface UseTranscriptTranslationResult {
  /** Last successfully loaded text — sticky across language switches so the panel
   *  keeps showing the previous language while the next one loads. */
  text: string | undefined;
  isLoading: boolean;
  isTranslating: boolean;
  error: string | undefined;
  retry: () => void;
}

/**
 * Lazily fetches transcript text per language via the translate-transcript endpoint
 * (`original` is a no-LLM passthrough). Any other language runs asynchronously on the
 * backend — a 'pending' response is polled until 'ready'. Local state, deliberately not
 * synced through Zero — Postgres never carries transcript text.
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
    let attempts = 0;
    setTranslatingLanguage(language);

    const poll = (): void => {
      void recordingService
        .translateTranscript(externalId, language)
        .then(result => {
          if (cancelled) return;
          cacheRef.current = { ...cacheRef.current, [language]: result };

          if (result.status === 'pending') {
            attempts += 1;
            if (attempts > TRANSLATION_POLL_MAX_ATTEMPTS) {
              setErrors(current => ({
                ...current,
                [language]: 'Translation is taking longer than expected.',
              }));
              setTranslatingLanguage(current => (current === language ? null : current));
              return;
            }
            window.setTimeout(poll, TRANSLATION_POLL_INTERVAL_MS);
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

    poll();

    return (): void => {
      cancelled = true;
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
