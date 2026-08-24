import { useCallback, useMemo } from 'react';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { useAllChannels } from './useChannels';

/**
 * Slack-Connect content transform (the guestChannelId → hostChannelId flip).
 *
 * For a guest, the channel id in the URL is their LOCAL pointer channel, which holds no
 * content of its own — the real conversations/messages live on the connect HOST channel.
 * Given the pointer id this returns the HOST channel id whose content should be read/written.
 * For a normal (non-connect) channel there is no connect_channel row, so it returns the id
 * unchanged.
 *
 * Use this ONLY at content "core places" (transcript / files / pins / canvas / composer —
 * the reads and writes). Navigation, URL, sidebar and channel identity/header must keep
 * using the original pointer id so the guest still sees *their own* channel.
 *
 * Backed by the Zero-synced `connect_channel` table (allow-all read ACL), so resolution is
 * a local lookup with no extra round-trip once synced.
 */
export function useHostChannelId(channelId: string | undefined): string | undefined {
  const [connect] = useCachedQuery(
    queries.connectChannelByGuestChannelId({ guestChannelId: channelId || '' }),
    { enabled: !!channelId },
  );
  return connect?.hostChannelId ?? channelId;
}

/**
 * Slack-Connect: is the current user an ACTIVE connect member of this (HOST) channel?
 * Use to suppress "Join channel" prompts / gate connect-only UI when the user is a connect
 * member but not a normal channel_participant. Pass the HOST channel id (resolve pointers first).
 */
export function useIsConnectMember(channelId: string | undefined): boolean {
  const [membership] = useCachedQuery(
    queries.connectMembershipForChannel({ channelId: channelId || '' }),
    { enabled: !!channelId },
  );
  return !!membership;
}

/**
 * Slack-Connect reverse map (HOST channelId → my local POINTER channelId).
 *
 * Content that lives on the host channel (tickets, conversations) carries the HOST channelId,
 * but a guest must NAVIGATE their own pointer channel — routing with the host id blanks the
 * conversation header (`useVisibleChannel(host)` is null for the guest). This returns a resolver
 * that maps a host id to the caller's pointer, and is a NO-OP for the host viewer or a
 * non-connect channel (the guest pointer isn't in their visible channel set, so it returns the
 * id unchanged). Use it wherever a host-owned entity is opened into the chat/ticket route.
 */
export function useHostToPointerChannelId(): (channelId: string) => string {
  const [links] = useCachedQuery(queries.activeConnectChannels());
  const allChannels = useAllChannels();
  const map = useMemo(() => {
    const m = new Map<string, string>();
    const visibleIds = new Set(allChannels.map(c => c.id));
    for (const link of links ?? []) {
      // Only my OWN pointer is in my visible set — a host viewer can't see a guest's pointer, so
      // they get no mapping and stay on the host id.
      if (link.guestChannelId && visibleIds.has(link.guestChannelId)) {
        m.set(link.hostChannelId, link.guestChannelId);
      }
    }
    return m;
  }, [links, allChannels]);
  return useCallback((channelId: string) => map.get(channelId) ?? channelId, [map]);
}

/** Minimal shape needed to compute a connect-aware member count. */
interface ConnectCountChannel {
  id: string;
  isConnectEnabled?: boolean | null | undefined;
  channelStats?: { participantCount?: number | null | undefined } | null | undefined;
}

/**
 * Slack-Connect: the TRUE member count of a channel, correct on both host and guest sides.
 *
 * `channel_stats.participantCount` is denormalised per-channel, so a guest's POINTER channel
 * only counts its own workspace's local participants — misleadingly low. For any connect
 * channel (host `isConnectEnabled`, or a guest pointer that resolves to a host) the real
 * roster is the active `connect_channel_member` list keyed by the HOST channel (host members
 * + every guest). This returns that count for connect channels and falls back to the plain
 * `channelStats.participantCount` for normal channels. Non-connect channels run no extra query.
 */
export function useConnectAwareParticipantCount(channel: ConnectCountChannel | undefined): number {
  const channelId = channel?.id;
  const hostChannelId = useHostChannelId(channelId);
  const isConnect =
    !!channel &&
    (channel.isConnectEnabled === true ||
      (!!hostChannelId && !!channelId && hostChannelId !== channelId));
  const [members] = useCachedQuery(
    queries.connectMembersForChannel({ channelId: hostChannelId || '' }),
    { enabled: isConnect && !!hostChannelId },
  );
  const statsCount = channel?.channelStats?.participantCount ?? 0;
  // Use the cross-org roster ONLY when it's actually populated — a host channel with the
  // Connect toggle on but no org joined yet has zero connect_channel_member rows, so it must
  // keep its normal local count. (A guest pointer always resolves to a host with members.)
  if (isConnect && members && members.length > 0) return members.length;
  return statsCount;
}
