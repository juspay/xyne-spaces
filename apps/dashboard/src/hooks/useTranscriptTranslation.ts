import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { TranscriptTranslation } from '@xyne/shared';
import { recordingService } from '../services/Recording/recordingService';
import { logRecordingError } from '../utils/recordingUtils';

export interface UseTranscriptTranslationOptions {
  externalId: string | undefined;
  language: string;
  /** Prefer the speaker-identified transcript for `original` (headless recordings only). */
  variant?: 'identified' | undefined;
  enabled: boolean;
}

export interface UseTranscriptTranslationResult {
  /** Last successfully loaded text — sticky across language switches so the panel
   *  keeps showing the previous language while the next one loads. */
  text: string | undefined;
  partial: boolean;
  isLoading: boolean;
  isTranslating: boolean;
  error: string | undefined;
  retry: () => void;
}

/**
 * Lazily fetches transcript text per language via the translate-transcript endpoint
 * (`original` is a no-LLM passthrough). Local state, deliberately not synced through
 * Zero — Postgres never carries transcript text (see calls.metadata.translations).
 */
export function useTranscriptTranslation({
  externalId,
  language,
  variant,
  enabled,
}: UseTranscriptTranslationOptions): UseTranscriptTranslationResult {
  const [cache, setCache] = useState<Record<string, TranscriptTranslation>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [translatingLanguage, setTranslatingLanguage] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState<TranscriptTranslation | undefined>(undefined);

  // Guards late responses from a call navigated away from before they resolved.
  const externalIdRef = useRef(externalId);
  externalIdRef.current = externalId;

  useEffect(() => {
    setCache({});
    setErrors({});
    setTranslatingLanguage(null);
    setDisplayed(undefined);
  }, [externalId]);

  useEffect(() => {
    if (!enabled || !externalId) return;
    const existing = cache[language];
    if (existing?.status === 'ready' && existing.text !== undefined) return;
    // A failed language never auto-retries — retry() clears the error, which refires this effect.
    if (errors[language] !== undefined) return;
    if (translatingLanguage === language) return;

    setTranslatingLanguage(language);
    void recordingService
      .translateTranscript(externalId, language, variant)
      .then(result => {
        if (externalIdRef.current !== externalId) return;
        setCache(current => ({ ...current, [language]: result }));
      })
      .catch((err: unknown) => {
        logRecordingError('useTranscriptTranslation', err);
        if (externalIdRef.current !== externalId) return;
        const message = axios.isAxiosError(err)
          ? (err.response?.data as { error?: string } | undefined)?.error
          : undefined;
        setErrors(current => ({ ...current, [language]: message ?? 'Please try again.' }));
      })
      .finally(() => {
        setTranslatingLanguage(current => (current === language ? null : current));
      });
  }, [enabled, language, externalId, variant, cache, errors, translatingLanguage]);

  const active = cache[language];
  useEffect(() => {
    if (active?.status === 'ready' && active.text !== undefined) {
      setDisplayed(active);
    }
  }, [active]);

  const retry = useCallback((): void => {
    setErrors(current => {
      if (!(language in current)) return current;
      const { [language]: _removed, ...rest } = current;
      return rest;
    });
  }, [language]);

  const error = errors[language];
  return {
    text: displayed?.text,
    partial: !!displayed?.partial,
    isLoading: enabled && !!externalId && displayed?.text === undefined && error === undefined,
    isTranslating: translatingLanguage === language,
    error,
    retry,
  };
}
