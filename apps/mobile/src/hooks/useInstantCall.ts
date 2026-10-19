import { useState, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { CallType, ChannelScopeType, UserStatus } from '@xyne/shared';
import { useUserPickerSearch } from './useUserPickerSearch';
import { useSelf } from './useUsers';
import { useCallActions, useIsInCall } from './useRoomMachine';
import { useZero } from './useZero';
import { useAllVisibleChannels, searchChannels } from './useChannels';
import { isUserDeactivated } from '@/src/utils/statusUtils';

export interface InstantCallParticipant {
  id: string;
  name: string;
  email: string;
  picture?: string | null;
  status?: UserStatus | null;
}

export interface InstantCallChannel {
  id: string;
  name: string;
  scopeType: string;
}

export type InstantCallItem =
  { type: 'user'; data: InstantCallParticipant } | { type: 'channel'; data: InstantCallChannel };

export function useInstantCall() {
  const self = useSelf();
  const zero = useZero();
  const { initiateCall } = useCallActions();
  const isInCall = useIsInCall();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<InstantCallParticipant[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<InstantCallChannel | null>(null);

  const rawResults = useUserPickerSearch(searchQuery, 20, self?.id);
  const allVisibleChannels = useAllVisibleChannels();

  // Only DEFAULT (public) channels — no DMs
  const defaultChannels = useMemo(
    () => allVisibleChannels.filter(c => c.scopeType === ChannelScopeType.DEFAULT),
    [allVisibleChannels],
  );

  const combinedResults = useMemo<InstantCallItem[]>(() => {
    const selectedIds = new Set(selectedUsers.map(u => u.id));

    const userItems: InstantCallItem[] = rawResults
      .filter(u => !selectedIds.has(u.id))
      .map(u => ({
        type: 'user' as const,
        data: {
          id: u.id,
          name: u.name ?? u.email ?? '',
          email: u.email ?? '',
          picture: u.picture ?? null,
          status: u.status,
        },
      }));

    const channelItems: InstantCallItem[] = searchChannels(defaultChannels, searchQuery, 10)
      .filter(c => c.id !== selectedChannel?.id)
      .map(c => ({
        type: 'channel' as const,
        data: { id: c.id, name: c.name, scopeType: c.scopeType },
      }));

    return [...userItems, ...channelItems].sort((a, b) => a.data.name.localeCompare(b.data.name));
  }, [rawResults, selectedUsers, defaultChannels, searchQuery, selectedChannel]);

  // Mutually exclusive: can't pick users when a channel is active, and vice versa
  const toggleUser = useCallback(
    (user: InstantCallParticipant) => {
      if (selectedChannel || isUserDeactivated(user)) return;
      setSelectedUsers(prev => {
        const exists = prev.some(u => u.id === user.id);
        if (exists) return prev.filter(u => u.id !== user.id);
        return [...prev, user];
      });
    },
    [selectedChannel],
  );

  const toggleChannel = useCallback(
    (channel: InstantCallChannel) => {
      if (selectedUsers.length > 0) return;
      setSelectedChannel(prev => (prev?.id === channel.id ? null : channel));
    },
    [selectedUsers],
  );

  const removeUser = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  }, []);

  const removeChannel = useCallback(() => {
    setSelectedChannel(null);
  }, []);

  const reset = useCallback(() => {
    setSearchQuery('');
    setSelectedUsers([]);
    setSelectedChannel(null);
  }, []);

  const canStart = selectedUsers.length > 0 || selectedChannel !== null;

  const startCall = useCallback(() => {
    if (!canStart) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your current call first.');
      return;
    }
    if (selectedChannel) {
      initiateCall({
        callType: CallType.AUDIO,
        channelId: selectedChannel.id,
        scopeType: selectedChannel.scopeType,
        zero,
      });
    } else {
      initiateCall({ callType: CallType.AUDIO, targetUserIds: selectedUsers.map(u => u.id), zero });
    }
  }, [canStart, selectedChannel, selectedUsers, initiateCall, zero, isInCall]);

  return {
    searchQuery,
    setSearchQuery,
    combinedResults,
    selectedUsers,
    selectedChannel,
    toggleUser,
    toggleChannel,
    removeUser,
    removeChannel,
    canStart,
    startCall,
    reset,
  };
}
