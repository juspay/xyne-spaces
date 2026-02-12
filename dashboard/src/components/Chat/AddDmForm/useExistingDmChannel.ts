import { Channel, ChannelScopeType, User } from '@xyne/shared';
import { useMemo } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useAllChannels } from '../../../hooks/useChannels';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';

/**
 * Hook to find an existing DM or Group DM channel that matches the selected participants
 * @param selectedUsers - Array of users selected for the conversation
 * @returns The matching channel if found, undefined otherwise
 */
export const useExistingDmChannel = (selectedUsers: User[]): Channel | undefined => {
  const { userID } = useAuthContextValues();
  const allChannels = useAllChannels();

  const dmChannels = useMemo(
    () =>
      allChannels.filter(
        channel =>
          channel.scopeType === ChannelScopeType.DM ||
          channel.scopeType === ChannelScopeType.GROUP_DM,
      ),
    [allChannels],
  );

  // Build the set of participant IDs we're looking for (selected users + current user)
  const targetParticipantIds = useMemo(() => {
    const ids = new Set<string>(selectedUsers.map(u => u.id));
    ids.add(userID);
    return ids;
  }, [selectedUsers, userID]);

  const matchingChannel = useMemo(() => {
    if (selectedUsers.length === 0) return undefined;

    return dmChannels.find(channel => {
      // Parse participant IDs from the channel name
      const participantIds = parseDMParticipantIds({
        name: channel.name,
        scopeType: channel.scopeType,
      });

      if (participantIds.length !== targetParticipantIds.size) {
        return false;
      }

      // Check if all participant IDs match the target set
      for (const id of participantIds) {
        if (!targetParticipantIds.has(id)) {
          return false;
        }
      }

      return true;
    });
  }, [dmChannels, selectedUsers.length, targetParticipantIds]);

  return matchingChannel;
};
