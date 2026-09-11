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
      twoStepSendEnabled,
      autoDraftMode,
      autoDraftAgentSlug,
      metricsEnabled,
      frtStageNames,
      appWebhookDeliveryEnabled,
      deskReportEnabled,
      deskReportAgentSlug,
      deskReportRangeDays,
    }: {
      channelId: string;
      ownerUserId?: string;
      assigneeUserGroupId?: string | null;
      sendAsEmail?: string | null;
      defaultCc?: string | null;
      emailMergeMode?: EmailMergeMode;
      twoStepSendEnabled?: boolean;
      autoDraftMode?: AutoDraftMode;
      autoDraftAgentSlug?: string | null;
      metricsEnabled?: boolean;
      frtStageNames?: string | null;
      appWebhookDeliveryEnabled?: boolean;
      deskReportEnabled?: boolean;
      deskReportAgentSlug?: string | null;
      deskReportRangeDays?: number;
    }): Promise<void> => {
      zero.mutate(
        mutators.emailChannelPreference.upsert({
          channelId,
          ...(ownerUserId !== undefined ? { ownerUserId } : {}),
          ...(assigneeUserGroupId !== undefined ? { assigneeUserGroupId } : {}),
          ...(sendAsEmail !== undefined ? { sendAsEmail } : {}),
          ...(defaultCc !== undefined ? { defaultCc } : {}),
          ...(emailMergeMode !== undefined ? { emailMergeMode } : {}),
          ...(twoStepSendEnabled !== undefined ? { twoStepSendEnabled } : {}),
          ...(autoDraftMode !== undefined ? { autoDraftMode } : {}),
          ...(autoDraftAgentSlug !== undefined
            ? { autoDraftAgentSlug: autoDraftAgentSlug || null }
            : {}),
          ...(metricsEnabled !== undefined ? { metricsEnabled } : {}),
          ...(frtStageNames !== undefined ? { frtStageNames } : {}),
          ...(appWebhookDeliveryEnabled !== undefined ? { appWebhookDeliveryEnabled } : {}),
          ...(deskReportEnabled !== undefined ? { deskReportEnabled } : {}),
          ...(deskReportAgentSlug !== undefined
            ? { deskReportAgentSlug: deskReportAgentSlug || null }
            : {}),
          ...(deskReportRangeDays !== undefined ? { deskReportRangeDays } : {}),
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
