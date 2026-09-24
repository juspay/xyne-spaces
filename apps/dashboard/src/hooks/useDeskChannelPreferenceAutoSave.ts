import { logger, Event as LogEvent } from '../utils/logger';
import { useCallback } from 'react';
import { EmailMergeMode, AutoDraftMode } from '@xyne/shared';
import {
  useUpdateEmailChannelPreference,
  type DuplicateScopeConfig,
} from './useEmailChannelPreference';

export type ChannelPreferencePatch = {
  ownerUserId?: string;
  assigneeUserGroupId?: string | null;
  sendAsEmail?: string | null;
  dlAliases?: string | null;
  defaultCc?: string | null;
  emailMergeMode?: EmailMergeMode;
  twoStepSendEnabled?: boolean;
  autoDraftMode?: AutoDraftMode;
  autoDraftAgentSlug?: string | null;
  metricsEnabled?: boolean;
  frtStageNames?: string | null;
  metricsGuestVisibility?: string | null;
  appWebhookDeliveryEnabled?: boolean;
  deskReportEnabled?: boolean;
  deskReportAgentSlug?: string | null;
  deskReportRangeDays?: number;
  duplicateScopeConfig?: DuplicateScopeConfig | null;
};

/**
 * Persists email channel preference fields immediately (used by Desk Settings auto-save).
 */
export function useDeskChannelPreferenceAutoSave(channelId: string | null) {
  const updateEmailChannelPreference = useUpdateEmailChannelPreference();

  const savePreference = useCallback(
    async (patch: ChannelPreferencePatch): Promise<void> => {
      if (!channelId) return;
      try {
        await updateEmailChannelPreference.mutateAsync({ channelId, ...patch });
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to save channel preference:'),
          error: error,
        });
        throw error;
      }
    },
    [channelId, updateEmailChannelPreference],
  );

  return { savePreference };
}
