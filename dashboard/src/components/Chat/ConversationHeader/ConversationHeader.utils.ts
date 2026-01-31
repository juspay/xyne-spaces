import { ChannelScopeType } from '@xyne/shared';
import { isOneToOneDMChannel, isGroupDMChannel } from '../ChatDirectory/ChatDirectory.utils';
/**
 * Gets the target user ID for a 1:1 DM call
 * For 1:1 DMs, returns the other participant's ID
 * For group DMs or channels, returns undefined
 */
export const getTargetUserIdForCall = (
  scopeType: ChannelScopeType | undefined,
  channelName: string | undefined,
  currentUserId: string,
): string | undefined => {
  const isDM = isOneToOneDMChannel(scopeType);
  const isGroupDM = isGroupDMChannel(scopeType);

  if (isDM && !isGroupDM && channelName) {
    const participantIds = channelName.split(',');
    return participantIds.find(id => id !== currentUserId);
  }

  return undefined;
};
