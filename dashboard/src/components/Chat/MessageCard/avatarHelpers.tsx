import { type ReactElement } from 'react';
import { Hash } from 'lucide-react';
import { ChannelVisibility, type Channel, type Conversation, type Message } from '@xyne/shared';
import { AvatarSize } from '@juspay/blend-design-system';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannel } from '../../../hooks/useChannels';
import { useUsers } from '../../../hooks/useUsers';
import UserAvatar from '../../UserAvatar/UserAvatar';
import ChannelIcon from '../ChannelIcon/ChannelIcon';
import {
  isOneToOneDMChannel,
  isGroupDMChannel,
  parseDMParticipantIds,
  getDMParticipantIdsToFetch,
} from '../ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface AvatarHelperProps {
  message?: Message | null;
  conversation?: Conversation | null;
}

interface RecipientAvatarProps extends AvatarHelperProps {
  className?: string;
}

const useResolvedChannel = (conversation?: Conversation | null): Channel | null => {
  const channelId = conversation?.channelId;
  return useChannel(channelId ?? '') ?? null;
};

const useOtherParticipantIds = (channel: Channel | null, currentUserId: string): string[] => {
  if (!channel) return [];
  if (!isOneToOneDMChannel(channel.scopeType) && !isGroupDMChannel(channel.scopeType)) return [];
  return getDMParticipantIdsToFetch(channel, currentUserId);
};

const useUsersByIds = (ids: string[]): Array<NonNullable<ReturnType<typeof useUsers>[number]>> => {
  const allUsers = useUsers();
  return ids.map(id => allUsers.find(u => u.id === id)).filter(Boolean) as Array<
    NonNullable<ReturnType<typeof useUsers>[number]>
  >;
};

/**
 * Renders the appropriate avatar for a message's recipient context.
 *
 * - DM: Shows the other person's UserAvatar
 * - Group DM: Shows the first participant's UserAvatar
 * - Channel (public): Hash icon in muted-foreground
 * - Channel (private): Lock icon in muted-foreground
 */
export function RecipientAvatar({ conversation, className }: RecipientAvatarProps): ReactElement {
  const { userID } = useAuthContextValues();
  const channel = useResolvedChannel(conversation);
  const otherIds = useOtherParticipantIds(channel, userID);
  const isDM = channel !== null && isOneToOneDMChannel(channel.scopeType);
  const isGroupDM = channel !== null && isGroupDMChannel(channel.scopeType);

  if (isDM) {
    return <UserAvatar userId={otherIds[0] ?? null} size={AvatarSize.SM} />;
  }

  if (isGroupDM) {
    const participantCount = channel ? parseDMParticipantIds(channel).length : 0;
    return (
      <div className={`flex items-center justify-center size-8 ${className ?? ''}`}>
        <span className='flex items-center justify-center size-6 rounded-md bg-sidebar-item-hover text-sidebar-secondary-foreground text-xs font-semibold'>
          {participantCount}
        </span>
      </div>
    );
  }

  if (channel) {
    return (
      <div className={`flex items-center justify-center size-8 ${className ?? ''}`}>
        <span className='inline-flex scale-110'>
          <ChannelIcon channel={channel} />
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center size-8 ${className ?? ''}`}>
      <Hash className='w-4 h-4 text-muted-foreground' />
    </div>
  );
}

/** Shared hook that resolves all recipient display data from a conversation. */
const useRecipientDisplay = (
  conversation?: Conversation | null,
): {
  channel: Channel | null;
  userID: string;
  dmUserIds: string[];
  dmUsers: Array<NonNullable<ReturnType<typeof useUsers>[number]>>;
  gdmUserIds: string[];
  gdmUsers: Array<NonNullable<ReturnType<typeof useUsers>[number]>>;
} => {
  const { userID } = useAuthContextValues();
  const channel = useResolvedChannel(conversation);

  const dmUserIds = useOtherParticipantIds(channel, userID);
  const dmUsers = useUsersByIds(dmUserIds);

  const gdmUserIds =
    channel && isGroupDMChannel(channel.scopeType)
      ? parseDMParticipantIds(channel)
          .filter(id => id !== userID)
          .slice(0, 4)
      : [];
  const gdmUsers = useUsersByIds(gdmUserIds);

  return { channel, userID, dmUserIds, dmUsers, gdmUserIds, gdmUsers };
};

const formatGroupDMNames = (userNames: string[], totalOther: number): string => {
  if (userNames.length === 0) return 'Group Chat';
  if (totalOther <= 3) return userNames.join(', ');
  const visibleNames = userNames.slice(0, 3);
  const remainingCount = totalOther - 3;
  return `${visibleNames.join(', ')} + ${remainingCount} other${remainingCount > 1 ? 's' : ''}`;
};

/**
 * Returns the display name for a message's recipient.
 *
 * - DM: The other person's display name (e.g. "Alice Cooper")
 * - Group DM: Comma-separated names, truncated if >3 (e.g. "Alice, Bob, Charlie + 3 others")
 * - Channel: The channel name (e.g. "general")
 */
export function useRecipientName(
  _message?: Message | null,
  conversation?: Conversation | null,
): string {
  const { channel, dmUsers, gdmUsers, gdmUserIds } = useRecipientDisplay(conversation);

  if (channel && isOneToOneDMChannel(channel.scopeType)) {
    const user = dmUsers[0];
    return user ? getUserDisplayName(user) : 'Unknown User';
  }

  if (channel && isGroupDMChannel(channel.scopeType)) {
    const userNames = gdmUsers.map(u => getUserDisplayName(u)).filter(Boolean);
    return formatGroupDMNames(userNames, gdmUserIds.length);
  }

  if (channel) {
    return channel.name || 'Unknown Channel';
  }

  return 'Unknown';
}

/** @see useRecipientName */
export const getRecipientName = useRecipientName;

/**
 * Returns a subtitle/info string for a message's recipient.
 *
 * - DM: Empty string (name is already specific)
 * - Group DM: Comma-separated participant names with truncation
 * - Channel (public): "# channel-name"
 * - Channel (private): "🔒 channel-name"
 */
export function useRecipientSubtitle(
  _message?: Message | null,
  conversation?: Conversation | null,
): string {
  const { channel, gdmUsers, gdmUserIds } = useRecipientDisplay(conversation);

  if (channel && isOneToOneDMChannel(channel.scopeType)) {
    return '';
  }

  if (channel && isGroupDMChannel(channel.scopeType)) {
    const userNames = gdmUsers.map(u => getUserDisplayName(u)).filter(Boolean);
    return formatGroupDMNames(userNames, gdmUserIds.length);
  }

  if (channel) {
    if (channel.visibility === ChannelVisibility.PRIVATE) {
      return `🔒 ${channel.name}`;
    }
    return `# ${channel.name}`;
  }

  return '';
}

/** @see useRecipientSubtitle */
export const getRecipientSubtitle = useRecipientSubtitle;
