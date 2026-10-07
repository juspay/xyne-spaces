import { ChannelScopeType, ChannelVisibility, UserStatus } from '@xyne/shared';
import { stateMachineActor } from '../../machines/stateMachine';
import { getAllChannels } from '../../hooks/useChannels';
import { resolveChannelLabel } from '../Chat/ChatDirectory/ChatDirectory.utils';
import type { Directory, Here } from './engine/resolve';
import { onScreen } from './onScreen';

// Read from the store when a name is resolved, so presence and channel changes re-render nothing.

/** The channels the user is a participant of, as far as the store knows. */
export const joinedChannelIds = (): Set<string> =>
  new Set(
    stateMachineActor
      .getSnapshot()
      .context.userChannelStatuses.filter(s => !s.isClosed && !s.isDeleted)
      .map(s => s.channelId),
  );

/** The conversation on screen, named as the search page names it; null where no page shows one. */
export const conversationOf = (selfId: string | null): Here | null => {
  const { channelId, conversationId } = onScreen.thread.get() ?? {};
  const channel = getAllChannels().find(({ id }) => id === channelId);
  if (!channelId || !channel) return null;
  const { users } = stateMachineActor.getSnapshot().context;
  const name =
    channel.scopeType === ChannelScopeType.DEFAULT
      ? `#${channel.name}`
      : resolveChannelLabel(channel, selfId ?? '', users);
  return {
    channelId,
    ...(conversationId ? { conversationId } : {}),
    label: conversationId ? `this thread in ${name}` : name,
    channel: name,
  };
};

/** The people and channels the user may pick; bots and agents too, so they can be mentioned. */
export const readDirectory = (here: Here | null): Directory => {
  const { users } = stateMachineActor.getSnapshot().context;
  const joined = joinedChannelIds();
  return {
    people: users.filter(user => user.status === UserStatus.ACTIVE),
    // As `useEmailChannels` filters them: a private one only once joined.
    channels: getAllChannels().filter(
      channel => channel.visibility !== ChannelVisibility.PRIVATE || joined.has(channel.id),
    ),
    here,
  };
};
