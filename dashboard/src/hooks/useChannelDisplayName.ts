import { useMemo } from 'react';
import { Channel, ChannelScopeType, ChannelType, ChannelVisibility } from '@xyne/shared';
import {
  isDMChannel,
  getDMParticipantIdsToFetch,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { useUsers } from './useUsers';

interface ChannelDisplay {
  displayName: string;
  avatarUserId: string | null;
  isLoading: boolean;
}

const DEFAULT_CHANNEL: Channel = {
  id: '',
  name: 'Unknown Channel',
  description: null,
  scopeType: ChannelScopeType.DEFAULT,
  visibility: ChannelVisibility.PUBLIC,
  type: ChannelType.DEFAULT,
  createdAt: 0,
  createdBy: '',
  updatedAt: 0,
  lastActivityAt: 0,
  metadata: null,
  projectId: '',
  participantCount: 0,
  isMigrated: null,
};

export const useChannelDisplayName = (
  channel: Channel | null | undefined,
  currentUserId: string,
): ChannelDisplay => {
  // Use fallback for null/undefined channels
  const safeChannel = channel || DEFAULT_CHANNEL;
  const userIdsToFetch = useMemo(
    () => getDMParticipantIdsToFetch(safeChannel, currentUserId),
    [safeChannel, currentUserId],
  );

  const allUsers = useUsers();
  const users = allUsers.filter(v => userIdsToFetch.some(u => u === v.id));
  const currentUser = allUsers.find(u => u.id === currentUserId);

  const totalOtherParticipants = useMemo(() => {
    if (!isDMChannel(safeChannel.scopeType)) return 0;
    const allIds = parseDMParticipantIds(safeChannel);
    return allIds.filter(id => id !== currentUserId).length;
  }, [safeChannel, currentUserId]);

  const displayInfo = useMemo((): ChannelDisplay => {
    if (!isDMChannel(safeChannel.scopeType)) {
      return {
        displayName: safeChannel.name,
        avatarUserId: null,
        isLoading: false,
      };
    }

    if (!users || users.length === 0) {
      const allIds = parseDMParticipantIds(safeChannel);
      const isSelfDm =
        safeChannel.scopeType === ChannelScopeType.DM &&
        allIds.length === 1 &&
        allIds[0] === currentUserId;

      if (isSelfDm) {
        const userName = `${currentUser?.name} (you)` || 'You';
        return {
          displayName: userName,
          avatarUserId: currentUserId,
          isLoading: false,
        };
      }

      return {
        displayName: safeChannel.scopeType === ChannelScopeType.DM ? 'Unknown User' : 'Group Chat',
        avatarUserId: null,
        isLoading: userIdsToFetch.length > 0,
      };
    }

    if (safeChannel.scopeType === ChannelScopeType.DM) {
      const user = users[0];
      return {
        displayName: user?.name || 'Unknown User',
        avatarUserId: user?.id || null,
        isLoading: false,
      };
    }

    if (safeChannel.scopeType === ChannelScopeType.GROUP_DM) {
      const userNames = users.map(u => u.name).filter(Boolean);

      if (userNames.length === 0) {
        return {
          displayName: 'Group Chat',
          avatarUserId: null,
          isLoading: false,
        };
      }

      if (totalOtherParticipants <= 3) {
        return {
          displayName: userNames.join(', '),
          avatarUserId: null,
          isLoading: false,
        };
      }
      const visibleNames = userNames.slice(0, 3);
      const remainingCount = totalOtherParticipants - 3;
      return {
        displayName: `${visibleNames.join(', ')} and ${remainingCount} other${remainingCount > 1 ? 's' : ''}`,
        avatarUserId: null,
        isLoading: false,
      };
    }

    return {
      displayName: safeChannel.name,
      avatarUserId: null,
      isLoading: false,
    };
  }, [
    safeChannel.name,
    safeChannel.scopeType,
    users,
    userIdsToFetch.length,
    totalOtherParticipants,
    currentUserId,
    currentUser,
  ]);

  return displayInfo;
};
