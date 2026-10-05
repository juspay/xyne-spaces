import { useMemo } from 'react';
import {
  ChannelRole,
  ChannelScopeType,
  MAX_CHANNEL_PUBLISHED_APPS,
  canPublishChannelApps,
  parsePublishedAppIds,
} from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { setAppSnapshot } from '../../hooks/barItems';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { surfaceMutationError } from '../../utils/zeroMutationToast';
import type { ArtifactAppSummary } from '../../services/claw/artifactAppsService';
import {
  isChannelTabsCustomizable,
  type ChannelTabsSource,
} from '../Chat/ConversationPannel/ConversationPannel.utils';

/** What the app picker needs to offer step 2, "Publish to channel". */
export interface AppPublishOptions {
  publishedAppIds: ReadonlySet<string>;
  /** The channel already has the maximum number of published apps. */
  isFull: boolean;
  onToggle: (app: ArtifactAppSummary, next: boolean) => void;
  /** Who a published app reaches, for the picker's copy. */
  audience: 'channel' | 'conversation';
}

/**
 * Publishing apps, for the people allowed to: a channel's ADMINs, or any
 * participant of a DM or group DM. Never a desk. Undefined for everyone else,
 * which is how the picker knows to show no publish controls at all.
 *
 * The rule is the shared `canPublishChannelApps`, which `channel.setPublishedApps`
 * and the channels ACL run again server-side — this only decides what to show.
 */
export const useChannelAppPublishing = (
  channelId: string,
  channel: ChannelTabsSource | null | undefined,
): AppPublishOptions | undefined => {
  const zero = useZero();
  // Only this user's ADMIN participations; the same source Canvas and Desk use.
  const [adminParticipations] = useCachedQuery(queries.myChannelParticipations({}));
  const isAdmin = (adminParticipations ?? []).some(
    p => p.channelId === channelId && p.role === ChannelRole.ADMIN,
  );
  const isDirect =
    channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;
  // A DM is only visible to its participants, so seeing one means being in it;
  // a channel needs the ADMIN row. The server checks the real participant row.
  const role = isAdmin ? ChannelRole.ADMIN : isDirect ? ChannelRole.MEMBER : null;
  const canPublish =
    isChannelTabsCustomizable(channel) && canPublishChannelApps(channel?.scopeType, role);
  const publishedAppIdsRaw = channel?.publishedAppIds;

  return useMemo((): AppPublishOptions | undefined => {
    if (!canPublish) return undefined;
    const current = parsePublishedAppIds(publishedAppIdsRaw);
    return {
      publishedAppIds: new Set(current),
      isFull: current.length >= MAX_CHANNEL_PUBLISHED_APPS,
      audience: isDirect ? 'conversation' : 'channel',
      onToggle: (app, next): void => {
        if (next) setAppSnapshot(app.id, { title: app.title, icon: app.icon });
        // One app per call: the mutator applies it to the row as it stands, so a
        // quick second click or another person publishing at once isn't lost.
        const args = { channelId, appId: app.id };
        void surfaceMutationError(
          zero.mutate(
            next ? mutators.channel.publishApp(args) : mutators.channel.unpublishApp(args),
          ),
          next ? 'Could not publish the app' : 'Could not unpublish the app',
        );
      },
    };
  }, [canPublish, publishedAppIdsRaw, channelId, zero, isDirect]);
};
