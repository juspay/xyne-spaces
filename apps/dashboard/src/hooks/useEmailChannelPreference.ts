import { useCallback } from 'react';
import { EmailMergeMode, AutoDraftMode } from '@xyne/shared';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';

/**
 * Scoped duplicate detection config stored on EmailChannelPreference.duplicateScopeConfig.
 */
export type DuplicateScopeConfig = {
  enabled: boolean;
  scopeFieldGlobalIds: string[];
};

/**
 * Normalize the raw column value. The column is serialized on write inside the Zero
 * mutator, so it should arrive as an object — the string branch is purely defensive
 * (mirrors the backend service's tolerant parser). Malformed shapes resolve to null,
 * which every reader treats as "legacy project-wide behavior".
 */
export const parseDuplicateScopeConfig = (raw: unknown): DuplicateScopeConfig | null => {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value) || value === null) return null;
  const config = value as Record<string, unknown>;
  const ids = config['scopeFieldGlobalIds'];
  if (typeof config['enabled'] !== 'boolean') return null;
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return null;
  return {
    enabled: config['enabled'],
    scopeFieldGlobalIds: ids,
  };
};

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
    async ({
      channelId,
      ownerUserId,
      assigneeUserGroupId,
      sendAsEmail,
      dlAliases,
      defaultCc,
      emailMergeMode,
      twoStepSendEnabled,
      autoDraftMode,
      autoDraftAgentSlug,
      metricsEnabled,
      frtStageNames,
      metricsGuestVisibility,
      appWebhookDeliveryEnabled,
      deskReportEnabled,
      deskReportAgentSlug,
      deskReportRangeDays,
      duplicateScopeConfig,
    }: {
      channelId: string;
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
    }): Promise<void> => {
      const mutation = zero.mutate(
        mutators.emailChannelPreference.upsert({
          channelId,
          ...(ownerUserId !== undefined ? { ownerUserId } : {}),
          ...(assigneeUserGroupId !== undefined ? { assigneeUserGroupId } : {}),
          ...(sendAsEmail !== undefined ? { sendAsEmail } : {}),
          ...(dlAliases !== undefined ? { dlAliases } : {}),
          ...(defaultCc !== undefined ? { defaultCc } : {}),
          ...(emailMergeMode !== undefined ? { emailMergeMode } : {}),
          ...(twoStepSendEnabled !== undefined ? { twoStepSendEnabled } : {}),
          ...(autoDraftMode !== undefined ? { autoDraftMode } : {}),
          ...(autoDraftAgentSlug !== undefined
            ? { autoDraftAgentSlug: autoDraftAgentSlug || null }
            : {}),
          ...(metricsEnabled !== undefined ? { metricsEnabled } : {}),
          ...(frtStageNames !== undefined ? { frtStageNames } : {}),
          ...(metricsGuestVisibility !== undefined ? { metricsGuestVisibility } : {}),
          ...(appWebhookDeliveryEnabled !== undefined ? { appWebhookDeliveryEnabled } : {}),
          ...(deskReportEnabled !== undefined ? { deskReportEnabled } : {}),
          ...(deskReportAgentSlug !== undefined
            ? { deskReportAgentSlug: deskReportAgentSlug || null }
            : {}),
          ...(deskReportRangeDays !== undefined ? { deskReportRangeDays } : {}),
          ...(duplicateScopeConfig !== undefined ? { duplicateScopeConfig } : {}),
        }),
      );
      // Zero resolves .server with the rejection instead of rejecting the promise.
      const result = await mutation.server;
      if (result?.type === 'error') {
        throw new Error(result.error?.message || 'Failed to save settings');
      }
    },
    [zero],
  );

  return {
    mutateAsync: updatePreference,
    isPending: false,
  };
}
