import { useCallback, useEffect, useRef, useState } from 'react';

import { callService } from '@/src/services/Call/callService';

import { callDetailService, type TranscriptTranslation } from '../services/call-detail-service';

export const ORIGINAL_TRANSCRIPT_LANGUAGE = 'original';

/** Mirrors SUPPORTED_TRANSCRIPT_LANGUAGES in @xyne/shared (newer than this app's pin). */
export const TRANSCRIPT_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: ORIGINAL_TRANSCRIPT_LANGUAGE, label: 'Original' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
];

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20;

export interface TranscriptState {
  text: string | undefined;
  isLoading: boolean;
  isTranslating: boolean;
  error: string | undefined;
  retry: () => void;
}

/**
 * A call's transcript in the chosen language. The original comes straight from
 * the download endpoint; other languages are translated server-side and polled
 * until ready (as the dashboard's useTranscriptTranslation does).
 */
export function useTranscriptTranslation(
  externalId: string | undefined,
  language: string,
  enabled: boolean,
): TranscriptState {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [translatingLanguage, setTranslatingLanguage] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState<{ language: string; text: string } | undefined>();

  useEffect(() => {
    cacheRef.current = new Map();
    setErrors(new Map());
    setTranslatingLanguage(null);
    setDisplayed(undefined);
  }, [externalId]);

  const currentError = errors.get(language);

  useEffect(() => {
    if (!enabled || !externalId) return;
    const cached = cacheRef.current.get(language);
    if (cached !== undefined) {
      setDisplayed({ language, text: cached });
      return;
    }
    if (currentError !== undefined) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const fail = (message: string): void => {
      setErrors(current => new Map(current).set(language, message));
      setTranslatingLanguage(current => (current === language ? null : current));
    };
    const land = (text: string): void => {
      cacheRef.current.set(language, text);
      setDisplayed({ language, text });
      setTranslatingLanguage(current => (current === language ? null : current));
    };

    if (language === ORIGINAL_TRANSCRIPT_LANGUAGE) {
      callService
        .downloadTranscript(externalId)
        .then(result => {
          if (!cancelled) land(result.data ?? '');
        })
        .catch(() => {
          if (!cancelled) fail('Failed to load transcript.');
        });
      return (): void => {
        cancelled = true;
      };
    }

    const poll = (): void => {
      callDetailService
        .translateTranscript(externalId, language)
        .then((result: TranscriptTranslation) => {
          if (cancelled) return;
          if (result.status === 'pending') {
            attempts += 1;
            if (attempts >= MAX_POLL_ATTEMPTS) {
              fail('Translation is taking too long. Please try again.');
              return;
            }
            setTranslatingLanguage(language);
            timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }
          land(result.text ?? '');
        })
        .catch(() => {
          if (!cancelled) fail('Translation failed. Please try again.');
        });
    };
    poll();

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

  const visibleText = displayed?.language === language ? displayed.text : undefined;
  return {
    // Keep showing the previous language while a translation is pending.
    text: visibleText ?? displayed?.text,
    isLoading: enabled && !!externalId && displayed === undefined && currentError === undefined,
    isTranslating:
      translatingLanguage === language ||
      (enabled && displayed !== undefined && visibleText === undefined && !currentError),
    error: currentError,
    retry,
  };
}
