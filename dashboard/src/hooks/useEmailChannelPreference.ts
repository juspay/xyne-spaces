import { useCallback } from 'react';
import { EmailMergeMode, AutoDraftMode } from '@xyne/shared';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';

/**
 * Returns the email channel preference for a channel from Zero cache.
 */
export function useEmailChannelPreference(channelId: string | null) {
  const [preferences] = useCachedQuery(
    queries.getEmailChannelPreference({ channelId: channelId || '' }),
    { enabled: !!channelId },
  );
  return preferences?.[0];
}

/**
 * Provides upsert operation for email channel preference.
 * Upserts by channelId (primary key) — one preference per channel.
 */
export function useUpdateEmailChannelPreference() {
  const zero = useZero();

  const updatePreference = useCallback(
    ({
      channelId,
      ownerUserId,
      assigneeUserGroupId,
      sendAsEmail,
      defaultCc,
      emailMergeMode,
      autoDraftMode,
    }: {
      channelId: string;
      ownerUserId?: string;
      assigneeUserGroupId?: string | null;
      sendAsEmail?: string | null;
      defaultCc?: string | null;
      emailMergeMode?: EmailMergeMode;
      autoDraftMode?: AutoDraftMode;
    }): Promise<void> => {
      zero.mutate(
        mutators.emailChannelPreference.upsert({
          channelId,
          ...(ownerUserId !== undefined ? { ownerUserId } : {}),
          ...(assigneeUserGroupId !== undefined ? { assigneeUserGroupId } : {}),
          ...(sendAsEmail !== undefined ? { sendAsEmail } : {}),
          ...(defaultCc !== undefined ? { defaultCc } : {}),
          ...(emailMergeMode !== undefined ? { emailMergeMode } : {}),
          ...(autoDraftMode !== undefined ? { autoDraftMode } : {}),
        }),
      );
      return Promise.resolve();
    },
    [zero],
  );

  return {
    mutateAsync: updatePreference,
    isPending: false, // Zero mutations are instant with optimistic updates
  };
}
