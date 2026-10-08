import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  ChannelRole,
  ChannelScopeType,
  MAX_PUBLISHED_APPS,
  canPublishChannelApps,
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
  setPublished: (appId: string, next: boolean) => void;
  /** Who a published app reaches, for the picker's copy. */
  audience: 'channel' | 'conversation';
}

/**
 * Publishing apps, for the people allowed to: a channel's ADMINs, or any
 * participant of a DM or group DM. Never a desk. Undefined for everyone else,
 * which is how the picker knows to show no publish controls at all.
 *
 * The rule is the shared `canPublishChannelApps`, which `channel.publishApp` /
 * `unpublishApp` and the channel_published_apps ACL run again server-side —
 * this only decides what to show.
 */
export const useChannelAppPublishing = (
  channelId: string,
  channel: ChannelTabsSource | null | undefined,
  /** From useChannelPublishedApps — stable until the ids change. */
  published: readonly string[],
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

  return useMemo((): AppPublishOptions | undefined => {
    if (!canPublish) return undefined;
    // One app per call: the mutator applies it to the rows as they stand, so a
    // quick second click or another person publishing at once isn't lost.
    const setPublished = (appId: string, next: boolean): void => {
      void surfaceMutationError(
        zero.mutate(
          next
            ? mutators.channel.publishApp({ id: uuidv4(), channelId, appId, timestamp: Date.now() })
            : mutators.channel.unpublishApp({ channelId, appId }),
        ),
        next ? 'Could not publish the app' : 'Could not unpublish the app',
      );
    };
    return {
      publishedAppIds: new Set(published),
      isFull: published.length >= MAX_PUBLISHED_APPS,
      audience: isDirect ? 'conversation' : 'channel',
      setPublished,
      onToggle: (app, next): void => {
        if (next) setAppSnapshot(app.id, { title: app.title, icon: app.icon });
        setPublished(app.id, next);
      },
    };
  }, [canPublish, published, channelId, zero, isDirect]);
};

export interface StagedAppPublishing {
  publish: AppPublishOptions | undefined;
  isPendingUnpublish: (appId: string) => boolean;
  commit: () => void;
  discard: () => void;
}

/** Holds publish/unpublish changes until `commit`, for the header's Save/Cancel edit mode. */
export const useStagedAppPublishing = (
  publish: AppPublishOptions | undefined,
): StagedAppPublishing => {
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  const staged = useMemo((): AppPublishOptions | undefined => {
    if (!publish) return undefined;
    const ids = new Set(publish.publishedAppIds);
    for (const [appId, next] of pending) {
      if (next) ids.add(appId);
      else ids.delete(appId);
    }
    const setPublished = (appId: string, next: boolean): void =>
      setPending(prev => {
        const updated = new Map(prev);
        if (publish.publishedAppIds.has(appId) === next) updated.delete(appId);
        else updated.set(appId, next);
        return updated;
      });
    return {
      ...publish,
      publishedAppIds: ids,
      isFull: ids.size >= MAX_PUBLISHED_APPS,
      setPublished,
      onToggle: (app, next): void => {
        if (next) setAppSnapshot(app.id, { title: app.title, icon: app.icon });
        setPublished(app.id, next);
      },
    };
  }, [publish, pending]);

  const commit = useCallback((): void => {
    if (publish) {
      // Unpublishes first, so publishes made room for still fit under the cap.
      for (const [appId, next] of pending) if (!next) publish.setPublished(appId, false);
      for (const [appId, next] of pending) if (next) publish.setPublished(appId, true);
    }
    setPending(new Map());
  }, [publish, pending]);

  const discard = useCallback((): void => setPending(new Map()), []);
  const isPendingUnpublish = useCallback(
    (appId: string): boolean => pending.get(appId) === false,
    [pending],
  );

  return { publish: staged, isPendingUnpublish, commit, discard };
};
