import { useCallback, useMemo, useState } from 'react';
import { useZero } from './useZero';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { mutators } from '../zero/mutators';
import { classificationApi } from '../api/classificationApi';
import type {
  SaveConfigPayload,
  SaveMappingPayload,
  ClassificationPreviewResult,
  ClassificationMapping,
} from '../types/classification';

export const useEmailClassification = (channelId: string, mappingsEnabled = false) => {
  const zero = useZero();

  // ─── Zero reads (real-time, no REST needed) ───────────────────────────────

  const [prefRows] = useCachedQuery(queries.getEmailChannelPreference({ channelId }), {
    enabled: !!channelId && mappingsEnabled,
  });
  const pref = prefRows?.[0] ?? null;

  const [mappingRows] = useCachedQuery(queries.getClassificationMappings({ channelId }), {
    enabled: !!channelId && mappingsEnabled,
  });
  const mappings: ClassificationMapping[] = useMemo(
    () => (mappingRows ?? []) as ClassificationMapping[],
    [mappingRows],
  );

  const config = pref
    ? {
        channelId: pref.channelId,
        enabled: pref.classificationEnabled ?? false,
        classificationPrompt: pref.classificationPrompt ?? '',
        categoryField: pref.categoryField ?? 'Query Type',
        subCategoryField: pref.subCategoryField ?? null,
        mappings,
      }
    : null;

  // ─── Mutations (via Zero mutators) ───────────────────────────────────────

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveConfig = useCallback(
    (payload: SaveConfigPayload): Promise<void> => {
      setIsSaving(true);
      setError(null);
      void zero.mutate(
        mutators.emailChannelPreference.upsertClassificationConfig({
          channelId,
          classificationEnabled: payload.enabled,
          classificationPrompt: payload.classificationPrompt,
          categoryField: payload.categoryField,
          subCategoryField: payload.subCategoryField ?? null,
        }),
      );
      setIsSaving(false);
      return Promise.resolve();
    },
    [zero, channelId],
  );

  const createMapping = useCallback(
    (payload: SaveMappingPayload & { id?: string; createdAt?: number }): Promise<void> => {
      setError(null);
      void zero.mutate(
        mutators.classificationMapping.create({
          id: payload.id ?? crypto.randomUUID(),
          channelId,
          category: payload.category,
          subCategory: payload.subCategory ?? null,
          userGroupId: payload.userGroupId,
          createdAt: payload.createdAt ?? Date.now(),
        }),
      );
      return Promise.resolve();
    },
    [zero, channelId],
  );

  const updateMapping = useCallback(
    (mappingId: string, payload: Partial<SaveMappingPayload>): Promise<void> => {
      setError(null);
      void zero.mutate(
        mutators.classificationMapping.update({
          id: mappingId,
          ...(payload.category !== undefined ? { category: payload.category } : {}),
          ...(payload.subCategory !== undefined
            ? { subCategory: payload.subCategory ?? null }
            : {}),
          ...(payload.userGroupId !== undefined ? { userGroupId: payload.userGroupId } : {}),
        }),
      );
      return Promise.resolve();
    },
    [zero],
  );

  const deleteMapping = useCallback(
    (mappingId: string): Promise<void> => {
      setError(null);
      void zero.mutate(mutators.classificationMapping.delete({ id: mappingId }));
      return Promise.resolve();
    },
    [zero],
  );

  // ─── Preview (stays as REST — requires LLM call) ─────────────────────────

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<ClassificationPreviewResult | null>(null);

  const runPreview = useCallback(
    async (emailSubject: string, emailBody: string): Promise<void> => {
      setIsPreviewing(true);
      setError(null);
      try {
        const result = await classificationApi.previewClassification(
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
    createMapping,
    updateMapping,
    deleteMapping,
    previewResult,
    isPreviewing,
    runPreview,
    error,
  };
};
