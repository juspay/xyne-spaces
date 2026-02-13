import { Channel, ChannelScopeType } from '@xyne/shared';
import { parseDMParticipantIds } from '../components/Chat/ChatDirectory/ChatDirectory.utils';

export type ScopeTypeFilter = 'DM' | 'GROUP_DM';

export interface CommonChannelsResult {
  dm: Channel[];
  group_dm: Channel[];
}

/**
 * Filters channels to find common channels between two users.
 * Only supports DM and GROUP_DM channels since they store participant info in metadata.
 *
 * @param allChannels - All available channels
 * @param userId1 - The first user's ID
 * @param userId2 - The second user's ID
 * @param scopeTypes - Array of scope types to filter (only 'DM' and 'GROUP_DM' are supported)
 * @returns Categorized common channels
 *
 * @example
 * ```tsx
 * const commonChannels = getCommonChannels(allChannels, user1Id, user2Id, ['DM', 'GROUP_DM']);
 * ```
 */
export function getCommonChannels(
  allChannels: Channel[],
  userId1: string,
  userId2: string,
  scopeTypes: ScopeTypeFilter[] = ['DM', 'GROUP_DM'],
): CommonChannelsResult {
  const result: CommonChannelsResult = {
    dm: [],
    group_dm: [],
  };

  if (!userId1 || !userId2 || userId1 === userId2) {
    return result;
  }

  const scopeTypeMap: Record<ScopeTypeFilter, ChannelScopeType> = {
    DM: ChannelScopeType.DM,
    GROUP_DM: ChannelScopeType.GROUP_DM,
  };

  const allowedScopeTypes = new Set(scopeTypes.map(st => scopeTypeMap[st]));

  allChannels.forEach(channel => {
    if (!allowedScopeTypes.has(channel.scopeType)) {
      return;
    }

    if (
      channel.scopeType === ChannelScopeType.DM ||
      channel.scopeType === ChannelScopeType.GROUP_DM
    ) {
      const participantIds = parseDMParticipantIds(channel);
      const hasUser1 = participantIds.includes(userId1);
      const hasUser2 = participantIds.includes(userId2);

      if (!hasUser1 || !hasUser2) {
        return;
      }

      if (channel.scopeType === ChannelScopeType.DM) {
        result.dm.push(channel);
      } else if (channel.scopeType === ChannelScopeType.GROUP_DM) {
        result.group_dm.push(channel);
      }
    }
  });

  return result;
}
