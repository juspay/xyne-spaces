import { useCallback } from 'react';
import { toast } from 'sonner';
import { EmailMergeMode, AutoDraftMode } from '@xyne/shared';
import { useUpdateEmailChannelPreference } from './useEmailChannelPreference';

export type ChannelPreferencePatch = {
  ownerUserId?: string;
  assigneeUserGroupId?: string | null;
  sendAsEmail?: string | null;
  defaultCc?: string | null;
  emailMergeMode?: EmailMergeMode;
  autoDraftMode?: AutoDraftMode;
  autoDraftAgentSlug?: string | null;
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
        console.error('Failed to save channel preference:', error);
        toast.error('Failed to save settings', {
          description: 'Your change was not saved. Please try again.',
        });
        throw error;
      }
    },
    [channelId, updateEmailChannelPreference],
  );

  return { savePreference };
}
