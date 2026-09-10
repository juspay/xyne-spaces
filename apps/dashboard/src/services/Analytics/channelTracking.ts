import { ChannelScopeType } from '@xyne/shared';

interface TrackableChannel {
  id: string;
  name?: string | null;
  scopeType?: string | null;
  type?: string | null;
}

const NON_DISPLAY_NAME_SCOPES = new Set<string>([ChannelScopeType.DM, ChannelScopeType.GROUP_DM]);

/**
 * Channel dimensions for `data-track-metadata` / `trackManualEvent`.
 *
 * `Channel.name` is a human name only for non-DM scopes: a DM stores a sorted
 * user-id pair and a self-DM the user id. Those are unreadable in reports and
 * are a social-graph edge that does not belong in the event store, so DM and
 * group-DM rows carry `channelId` + `scopeType` only.
 */
export function channelTrackingMetadata(
  channel: TrackableChannel | null | undefined,
): Record<string, unknown> {
  if (!channel) return {};
  const isDmScope = NON_DISPLAY_NAME_SCOPES.has(channel.scopeType ?? '');
  return {
    channelId: channel.id,
    ...(channel.name && !isDmScope && { channelName: channel.name }),
    ...(channel.scopeType && { scopeType: channel.scopeType }),
    ...(channel.type && { channelType: channel.type }),
  };
}
