import type { Channel } from '@xyne/shared';

import { getChannelDisplayName } from '@/src/hooks/useChannels';

import { getNavigationTarget } from '../presentation/activityRowAssembler';
import type { ActivityRowContext } from './row';

type ContextUser = ActivityRowContext['users'][number];

/**
 * The lookups one pass over the feed shares: users and channels by id, and the
 * app's own channel naming and navigation rules.
 *
 * Built once per change to users or channels and discarded with them, so a row
 * never builds a map of its own.
 */
export function createActivityRowContext(
  users: readonly ContextUser[],
  channels: readonly Channel[],
  currentUserId: string,
): ActivityRowContext {
  return {
    currentUserId,
    users,
    usersById: new Map(users.map(user => [user.id, user])),
    channelsById: new Map(channels.map(channel => [channel.id, channel])),
    channelLabel: channel => getChannelDisplayName(channel, currentUserId, users),
    navigationTarget: getNavigationTarget,
  };
}
