import { useState, useCallback, useMemo } from 'react';
import { useChannel, useAllVisibleChannels } from './useChannels';
import { ChannelScopeType } from '@xyne/shared';
import { useAuthContextValues, useAuth } from './useAuth';
import type { MentionResult } from '../components/ui/Selectors';
import { useSelf, useUsers, useUserSearch } from './useUsers';
import type { User } from '../machines/stateMachine';
import { useUserGroupSearch } from './useUserGroupSearch';
import { getUserDisplayName } from '../utils/userDisplayName';

interface UseMentionSearchResult {
  results: MentionResult[];
  users: MentionResult[];
  allUsers: MentionResult[];
  isLoading: boolean;
  error: string | null;
  searchMentions: (query: string) => void;
  clearResults: () => void;
}

const getUserPicture = (name: string, picture: string | null): string => {
  if (picture) return picture;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0ea5e9&color=fff`;
};

export const useMentionSearch = (channelId?: string): UseMentionSearchResult => {
  const context = useAuthContextValues();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const shouldSearch = searchQuery.trim().length > 0;
  const usersData = useUserSearch(searchQuery, 10);
  const userGroupsData = useUserGroupSearch(searchQuery, 10);

  const currentUser = useSelf();

  // All users in the workspace – used for sorting and mention resolution
  const allWorkspaceUsers = useUsers();

  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allWorkspaceUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allWorkspaceUsers]);

  // Get channel to determine scope type
  const channel = useChannel(channelId || '');

  // Determine if this is a DM or regular channel
  const isDMChannel = channel?.scopeType === ChannelScopeType.DM;
  const channelDataReady = channel && channel.id === channelId;

  // Get participants based on channel type when not searching
  const dmParticipants = channel?.name.split(',');

  const visibleChannels = useAllVisibleChannels();
  const cachedDMParticipants = useMemo(() => {
    const currentUserId = user?.id;
    const sortedDmChannels = visibleChannels
      .filter(
        ch => ch.scopeType === ChannelScopeType.DM || ch.scopeType === ChannelScopeType.GROUP_DM,
      )
      .sort(
        (a, b) => (b.channelStats?.lastActivityAt || 0) - (a.channelStats?.lastActivityAt || 0),
      );

    const dmUserIds: string[] = [];

    for (const ch of sortedDmChannels) {
      if (dmUserIds.length >= 10) break;

      for (const participantId of ch.name.split(',')) {
        if (dmUserIds.length >= 10) break;
        if (participantId !== currentUserId && !dmUserIds.includes(participantId)) {
          dmUserIds.push(participantId);
        }
      }
    }

    if (dmUserIds.length > 0) {
      return dmUserIds;
    }

    if (!allWorkspaceUsers?.length) return [];

    return allWorkspaceUsers
      .filter(u => u.id !== currentUserId)
      .sort(() => Math.random() - 0.5)
      .slice(0, 10)
      .map(u => u.id);
  }, [visibleChannels, user?.id, allWorkspaceUsers]);

  // Get all users for mention resolution (used when sending messages)
  const allUsersData = useUsers();

  // Helper to convert user to MentionResult
  const toMentionResult = useCallback((user: User, isCurrentUser = false): MentionResult => {
    const displayName = getUserDisplayName(user);
    return {
      id: user.id,
      name: isCurrentUser ? `${displayName} (you)` : displayName,
      username: displayName,
      type: 'user' as const,
      email: user.email,
      picture: getUserPicture(displayName, user.picture),
      avatar: displayName.charAt(0).toUpperCase(),
    };
  }, []);

  // All users in the system for mention resolution when sending messages
  const allUsers = useMemo((): MentionResult[] => {
    if (!allUsersData || allUsersData.length === 0) {
      return [];
    }

    return allUsersData.map(u => toMentionResult(u));
  }, [allUsersData, toMentionResult]);

  const users = useMemo(() => {
    if (shouldSearch) {
      if (!usersData) return [];

      const baseUsers = usersData.map(user => {
        const displayName = getUserDisplayName(user);
        return {
          id: user.id,
          name: context.userID === user.id ? `${displayName} (you)` : displayName,
          username: displayName,
          type: 'user' as const,
          email: user.email,
          picture: getUserPicture(displayName, user.picture),
          avatar: displayName.charAt(0).toUpperCase(),
        };
      });

      if (isDMChannel) {
        return baseUsers;
      }

      // For regular channels, prioritize users who are in DMs with current user
      const dmUserIds = new Set(cachedDMParticipants);
      return baseUsers
        .map(user => ({
          ...user,
          isInDM: dmUserIds.has(user.id),
        }))
        .sort((a, b) => {
          // Sort users in DMs before others
          if (a.isInDM && !b.isInDM) return -1;
          if (!a.isInDM && b.isInDM) return 1;
          return 0;
        });
    }

    // Get participants based on channel type
    let sortedParticipants: MentionResult[] = [];

    if (isDMChannel) {
      // For DM channels, just use DM participants
      sortedParticipants =
        dmParticipants
          ?.filter(p => p !== user?.id)
          .sort((a, b) => {
            const userA = usersById.get(a);
            const userB = usersById.get(b);
            return (
              (userB?.presenceStatus?.lastActiveAt || 0) -
              (userA?.presenceStatus?.lastActiveAt || 0)
            );
          })
          .map(p => {
            const u = usersById.get(p);
            return u ? toMentionResult(u) : null;
          })
          .filter((u): u is MentionResult => u !== null) || [];
    } else {
      // For regular channels, initially use cached DM participants
      sortedParticipants = cachedDMParticipants
        .map(userId => {
          const u = usersById.get(userId);
          return u ? toMentionResult(u) : null;
        })
        .filter((u): u is MentionResult => u !== null)
        .sort((a, b) => {
          const userA = usersById.get(a.id);
          const userB = usersById.get(b.id);
          return (
            (userB?.presenceStatus?.lastActiveAt || 0) - (userA?.presenceStatus?.lastActiveAt || 0)
          );
        })
        .slice(0, 10);
    }

    // Current user first, then other participants
    return sortedParticipants;
  }, [
    usersData,
    shouldSearch,
    currentUser,
    isDMChannel,
    dmParticipants,
    cachedDMParticipants,
    usersById,
    toMentionResult,
    user?.id,
    context.userID,
  ]);

  // Convert user groups to MentionResult format
  const groups = useMemo(() => {
    if (!userGroupsData || userGroupsData.length === 0) {
      return [];
    }

    return userGroupsData.map(group => ({
      id: group.id,
      name: group.name,
      type: 'group' as const,
      ...(group.alias && { alias: group.alias }),
      ...(group.description && { description: group.description }),
      memberCount: 0,
      isDeactivated: group.isActive === false,
    }));
  }, [userGroupsData]);

  const results = useMemo(() => {
    // Add special mentions (@channel and @here) only for non-DM channels
    const specialMentions: MentionResult[] = [];

    if (shouldSearch && !isDMChannel && channelDataReady) {
      const allSpecialMentions = [
        {
          id: 'special-channel',
          name: 'channel',
          type: 'channel' as const,
          isSpecial: true,
          description: 'Notify all members in this channel',
        },
        {
          id: 'special-here',
          name: 'here',
          type: 'here' as const,
          isSpecial: true,
          description: 'Notify all online members',
        },
      ];

      // Filter special mentions based on search query
      if (shouldSearch) {
        const query = searchQuery.toLowerCase();
        allSpecialMentions.forEach(mention => {
          if (mention.name.toLowerCase().includes(query)) {
            specialMentions.push(mention);
          }
        });
      } else {
        // No search query, show all special mentions
        specialMentions.push(...allSpecialMentions);
      }
    }

    // Order: Special mentions (@channel, @here) -> Users -> User Groups
    return [...specialMentions, ...users, ...groups];
  }, [users, groups, isDMChannel, shouldSearch, channelDataReady, searchQuery]);

  const searchMentions = useCallback((query: string) => {
    setError(null);
    setSearchQuery(query);
  }, []);

  const clearResults = useCallback(() => {
    setSearchQuery('');
    setError(null);
  }, []);

  return {
    results,
    users,
    allUsers,
    isLoading: false,
    error,
    searchMentions,
    clearResults,
  };
};
