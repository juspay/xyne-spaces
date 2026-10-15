import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { showMessageToast } from '@/src/utils/toast';

import { dailyBriefApi, type DailyBriefConfig } from '../api/dailyBriefApi';
import { briefKeys } from './useBriefQueries';

export interface BriefConfigPatch {
  enabled?: boolean;
  instructions?: string;
  instructionsEnabled?: boolean;
}

/**
 * Save the brief config with an optimistic cache update and rollback — the
 * mobile counterpart of the web's dailyBriefEnabledStore.
 *
 * NOTE: the API force-enables instructions when `instructions` is sent
 * without `instructionsEnabled`, so callers editing instructions must always
 * send both fields.
 */
export function useBriefConfigMutation(): UseMutationResult<
  DailyBriefConfig,
  Error,
  BriefConfigPatch,
  { previous: DailyBriefConfig | undefined }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: BriefConfigPatch) => dailyBriefApi.saveConfig(patch),
    onMutate: async patch => {
      await queryClient.cancelQueries({ queryKey: briefKeys.config() });
      const previous = queryClient.getQueryData<DailyBriefConfig>(briefKeys.config());
      if (previous) {
        queryClient.setQueryData<DailyBriefConfig>(briefKeys.config(), {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (_error, patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(briefKeys.config(), context.previous);
      }
      showMessageToast(
        patch.enabled !== undefined
          ? `Could not turn the morning brief ${patch.enabled ? 'on' : 'off'}.`
          : 'Could not save brief settings.',
        'error',
      );
    },
    onSuccess: config => {
      queryClient.setQueryData(briefKeys.config(), config);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: briefKeys.config() });
    },
  });
}
