import { useMemo } from 'react';
import { MAX_CHANNEL_PUBLISHED_APPS, parsePublishedAppIds } from '@xyne/shared';
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
}

/**
 * Publishing apps to a channel, for the people allowed to: channel ADMINs, in
 * a customizable channel (never a DM or a desk). Undefined for everyone else,
 * which is how the picker knows to show no publish controls at all.
 *
 * The server repeats every check — `channel.setPublishedApps` and the channels
 * ACL both require an ADMIN and refuse desks — so this only decides what to show.
 */
export const useChannelAppPublishing = (
  channelId: string,
  channel: ChannelTabsSource | null | undefined,
): AppPublishOptions | undefined => {
  const zero = useZero();
  // Only this user's ADMIN participations; the same source Canvas and Desk use.
  const [adminParticipations] = useCachedQuery(queries.myChannelParticipations({}));
  const isAdmin = (adminParticipations ?? []).some(p => p.channelId === channelId);
  const canPublish = isAdmin && isChannelTabsCustomizable(channel);
  const publishedAppIdsRaw = channel?.publishedAppIds;

  return useMemo((): AppPublishOptions | undefined => {
    if (!canPublish) return undefined;
    const current = parsePublishedAppIds(publishedAppIdsRaw);
    return {
      publishedAppIds: new Set(current),
      isFull: current.length >= MAX_CHANNEL_PUBLISHED_APPS,
      onToggle: (app, next): void => {
        if (next) setAppSnapshot(app.id, { title: app.title, icon: app.icon });
        const appIds = next ? [...current, app.id] : current.filter(id => id !== app.id);
        void surfaceMutationError(
          zero.mutate(mutators.channel.setPublishedApps({ channelId, appIds })),
          next ? 'Could not publish the app to this channel' : 'Could not unpublish the app',
        );
      },
    };
  }, [canPublish, publishedAppIdsRaw, channelId, zero]);
};
