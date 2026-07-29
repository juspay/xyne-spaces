import { useCallback, useMemo, useState } from 'react';
import { useZero } from './useZero';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { mutators } from '../zero/mutators';
import { priorityClassificationApi } from '../api/priorityClassificationApi';
import type {
  SavePriorityConfigPayload,
  PriorityClassificationPreviewResult,
  PriorityClassificationConfig,
} from '../types/priorityClassification';

export const usePriorityClassification = (channelId: string) => {
  const zero = useZero();

  // ─── Zero reads (real-time, no REST needed) ───────────────────────────────

  const [prefRows] = useCachedQuery(queries.getEmailChannelPreference({ channelId }), {
    enabled: !!channelId,
  });
  const pref = prefRows?.[0] ?? null;

  const config: PriorityClassificationConfig | null = useMemo(() => {
    if (!pref) return null;
    return {
      enabled: pref.priorityClassificationEnabled ?? false,
      priorityClassificationPrompt: pref.priorityClassificationPrompt ?? null,
      priorityClassificationThreshold: pref.priorityClassificationThreshold ?? 0.5,
    };
  }, [pref]);

  // ─── Mutations (via Zero mutators) ───────────────────────────────────────

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveConfig = useCallback(
    (payload: SavePriorityConfigPayload): Promise<void> => {
      setIsSaving(true);
      setError(null);
      try {
        // Using void operator to acknowledge the promise is intentionally not awaited
        // Zero mutations use optimistic updates and handle errors internally
        void zero.mutate(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
          mutators.emailChannelPreference.upsertPriorityClassificationConfig({
            channelId,
            priorityClassificationEnabled: payload.enabled,
            priorityClassificationPrompt: payload.priorityClassificationPrompt ?? null,
            priorityClassificationThreshold: payload.priorityClassificationThreshold ?? 0.5,
          }),
        );
        setIsSaving(false);
        return Promise.resolve();
      } catch (err) {
        setIsSaving(false);
        const errorMessage = err instanceof Error ? err.message : 'Failed to save configuration';
        setError(errorMessage);
        return Promise.reject(new Error(errorMessage));
      }
    },
    [zero, channelId],
  );

  // ─── Preview (stays as REST — requires LLM call) ─────────────────────────

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<PriorityClassificationPreviewResult | null>(
    null,
  );

  const runPreview = useCallback(
    async (emailSubject: string, emailBody: string): Promise<void> => {
      setIsPreviewing(true);
      setError(null);
      try {
        const result = await priorityClassificationApi.previewClassification(
          channelId,
          emailSubject,
          emailBody,
        );
        setPreviewResult(result);
      } catch {
        setError('Preview classification failed');
      } finally {
        setIsPreviewing(false);
      }
    },
    [channelId],
  );

  return {
    config,
    isLoading: false,
    isSaving,
    saveConfig,
    previewResult,
    isPreviewing,
    runPreview,
    error,
  };
};
