import { LegendList } from '@legendapp/list/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Search, X } from 'lucide-react-native';
import { memo, ReactElement, useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { ChannelRole } from '@xyne/shared';

import { MemberActionsMenu } from '@/src/features/chat/channel-members/member-actions-menu';
import { RemoveMemberSheet } from '@/src/features/chat/channel-members/remove-member-sheet';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { haptics } from '@/src/utils/haptics';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import {
  canRemoveParticipantsInChannel,
  getMemberActionFlags,
  getMemberActions,
  type MemberActionId,
} from '@/src/features/chat/channel-members/channel-member-actions';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useChannelMemberActions } from '@/src/hooks/useChannelMemberActions';
import { useChannelDisplayName, useVisibleChannelById } from '@/src/hooks/useChannels';
import { useUserPresence } from '@/src/hooks/usePresence';
import { useUser, useUsers } from '@/src/hooks/useUsers';
import { getActiveUserStatus } from '@/src/utils/channel-utils';
import { getActiveUserStatusEmoji } from '@/src/utils/statusUtils';
import { queries } from '@/src/zero/queries';

type MemberRowData = {
  userId: string;
  name: string;
  picture: string;
  isAdmin: boolean;
  isCreator: boolean;
};

type MemberRowProps = MemberRowData & {
  currentUserId: string;
  isChannelCreator: boolean;
  canRemoveParticipants: boolean;
  onPressUser: (userId: string) => void;
  onAction: (action: MemberActionId, member: { userId: string; name: string }) => void;
};

const MemberRow = memo(
  ({
    name,
    userId,
    isAdmin,
    isCreator,
    currentUserId,
    isChannelCreator,
    canRemoveParticipants,
    onPressUser,
    onAction,
  }: MemberRowProps): ReactElement => {
    const user = useUser(userId);
    const { isOnline } = useUserPresence(userId);
    const statusEmoji = getActiveUserStatusEmoji(user);
    const activeStatus = user ? getActiveUserStatus(user) : undefined;
    const statusLine = useMemo(
      () => activeStatus?.content?.trim() || (isOnline ? 'Active' : 'Inactive'),
      [activeStatus?.content, isOnline],
    );

    const flags = getMemberActionFlags({
      currentUserId,
      isChannelCreator,
      canRemoveParticipants,
      targetUserId: userId,
      targetIsCreator: isCreator,
    });
    const actions = getMemberActions({
      canManage: flags.canManage,
      canRemove: flags.canRemove,
      targetIsAdmin: isAdmin,
    });

    const handleAction = useCallback(
      (id: MemberActionId) => {
        onAction(id, { userId, name: name || userId });
      },
      [name, onAction, userId],
    );

    return (
      <View className='flex-row items-center px-4 py-2.5'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Open ${name || userId}'s profile`}
          onPress={() => onPressUser(userId)}
          onPressIn={(): void => {
            void haptics.buttonTap();
          }}
          className='min-w-0 flex-1 flex-row items-center gap-3 active:opacity-80'
        >
          <View className='relative shrink-0'>
            <Avatar userIds={[userId]} size={32} />
            <PresenceDot userId={userId} />
          </View>
          <View className='flex-1 min-w-0'>
            <View className='flex-row items-center gap-1.5 min-w-0'>
              <Text
                className='text-sm font-medium text-foreground shrink min-w-0'
                numberOfLines={1}
              >
                {name || userId}
              </Text>
              {statusEmoji ? (
                <View className='shrink-0'>
                  <ReactionEmojiDisplay emojiName={statusEmoji} size={14} />
                </View>
              ) : null}
              {(isAdmin || isCreator) && (
                <View className='shrink-0 rounded-full bg-foreground/90 px-1.5 py-px'>
                  <Text className='text-[10px] font-semibold leading-3.5 tracking-[0.3px] text-background'>
                    {isCreator ? 'Creator' : 'Admin'}
                  </Text>
                </View>
              )}
            </View>
            <Text className='text-xs text-secondary-foreground' numberOfLines={1}>
              {statusLine}
            </Text>
          </View>
        </Pressable>

        {flags.showMenu ? (
          <MemberActionsMenu
            key={userId}
            userId={userId}
            memberName={name || userId}
            actions={actions}
            onAction={handleAction}
          />
        ) : null}
      </View>
    );
  },
);
MemberRow.displayName = 'MemberRow';

const MembersScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mutedForegroundColor = useCSSVariable('--color-secondary-foreground') as string;
  const { userID: currentUserId } = useAuthContextValues();
  const allUsers = useUsers();

  const channel = useVisibleChannelById(channelId ?? '');
  const channelCreatedBy = channel?.createdBy ?? '';
  const channelDisplayName = useChannelDisplayName(channel, currentUserId);

  const {
    makeAdmin,
    removeAdmin,
    requestRemove,
    dismissRemove,
    confirmRemove,
    removeTarget,
    isRemoving,
  } = useChannelMemberActions(channelId ?? '');

  const [searchQuery, setSearchQuery] = useState('');
  const trimmedSearchQuery = searchQuery.trim();
  const isSearching = trimmedSearchQuery.length > 0;

  // Load every participant in one query rather than paging. This is the same
  // query useConversationHeaderData already subscribes to for this channel (and
  // that hook runs on the info screen this one is opened from), so the rows are
  // already synced locally — paging added a second subscription plus cursor
  // bookkeeping without saving any work. LegendList virtualises the rows.
  const [participants, participantsDetails] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
    { enabled: !!channelId },
  );

  const currentUserIsAdmin = useMemo(
    () => participants.some(p => p.userId === currentUserId && p.role === ChannelRole.ADMIN),
    [participants, currentUserId],
  );
  const isChannelCreator = channelCreatedBy === currentUserId;
  const canRemoveParticipants = canRemoveParticipantsInChannel({
    scopeType: channel?.scopeType,
    currentUserIsAdmin,
  });

  const usersById = useMemo(() => {
    const map = new Map<string, { name: string; picture: string | null }>();
    for (const u of allUsers) {
      map.set(u.id, { name: u.name, picture: u.picture ?? null });
    }
    return map;
  }, [allUsers]);

  const isLoadingParticipants = participantsDetails.type === 'unknown' && participants.length === 0;

  const rows = useMemo<MemberRowData[]>(() => {
    const sorted = [...participants].sort((a, b) => {
      const aAdmin = a.role === ChannelRole.ADMIN ? 0 : 1;
      const bAdmin = b.role === ChannelRole.ADMIN ? 0 : 1;
      if (aAdmin !== bAdmin) return aAdmin - bAdmin;
      const aName = usersById.get(a.userId)?.name ?? '';
      const bName = usersById.get(b.userId)?.name ?? '';
      return aName.localeCompare(bName);
    });
    return sorted.map(p => {
      const user = usersById.get(p.userId);
      return {
        userId: p.userId,
        name: user?.name ?? '',
        picture: user?.picture ?? '',
        isAdmin: p.role === ChannelRole.ADMIN,
        isCreator: channelCreatedBy === p.userId,
      };
    });
  }, [participants, usersById, channelCreatedBy]);

  // Search filters the full local list — no separate query needed now that every
  // participant is loaded, so results are instant and can't disagree with the list.
  const displayRows = useMemo<MemberRowData[]>(() => {
    if (!isSearching) return rows;
    const q = trimmedSearchQuery.toLowerCase();
    return rows
      .filter(row => row.name.toLowerCase().includes(q) || row.userId.toLowerCase() === q)
      .sort((a, b) => {
        const aStartsWith = a.name.toLowerCase().startsWith(q);
        const bStartsWith = b.name.toLowerCase().startsWith(q);
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [rows, isSearching, trimmedSearchQuery]);

  const handlePressUser = useCallback(
    (userId: string) => {
      router.push(`/profile/${userId}`);
    },
    [router],
  );

  const handleMemberAction = useCallback(
    (action: MemberActionId, member: { userId: string; name: string }) => {
      if (action === 'make-admin') makeAdmin(member.userId);
      else if (action === 'remove-admin') removeAdmin(member.userId);
      else requestRemove(member);
    },
    [makeAdmin, removeAdmin, requestRemove],
  );

  const keyExtractor = useCallback((row: MemberRowData) => row.userId, []);

  const renderItem = useCallback(
    ({ item }: { item: MemberRowData }): ReactElement => (
      <MemberRow
        userId={item.userId}
        name={item.name}
        picture={item.picture}
        isAdmin={item.isAdmin}
        isCreator={item.isCreator}
        currentUserId={currentUserId}
        isChannelCreator={isChannelCreator}
        canRemoveParticipants={canRemoveParticipants}
        onPressUser={handlePressUser}
        onAction={handleMemberAction}
      />
    ),
    [canRemoveParticipants, currentUserId, handleMemberAction, handlePressUser, isChannelCreator],
  );

  return (
    <View className='flex-1 bg-settings-bg' style={{ paddingTop: insets.top }}>
      <View className='flex-row items-center gap-2 px-2 py-3'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} />
        <Text className='text-lg font-semibold text-foreground'>Members</Text>
      </View>

      <View className='px-3 pt-1 pb-2'>
        <View className='relative flex-row items-center'>
          <View
            className='absolute left-4 z-10 justify-center'
            style={{ top: 0, bottom: 0 }}
            pointerEvents='none'
          >
            <Search size={18} color={mutedForegroundColor} />
          </View>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder='Search'
            placeholderTextColor={mutedForegroundColor}
            className='flex-1 h-10 pl-11 pr-10 rounded-xl bg-foreground/5 text-lg text-foreground font-semibold'
            style={{ paddingVertical: 0, textAlignVertical: 'center', includeFontPadding: false }}
            autoCorrect={false}
            autoCapitalize='none'
            returnKeyType='search'
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => {
                void haptics.buttonTap();
                setSearchQuery('');
              }}
              className='absolute right-3 justify-center p-1'
              style={{ top: 0, bottom: 0 }}
            >
              <X size={16} color={mutedForegroundColor} />
            </Pressable>
          )}
        </View>
      </View>

      {isLoadingParticipants ? (
        <View className='flex-1 px-4 py-3'>
          {Array.from({ length: 8 }, (_, index) => (
            <View key={index} className='flex-row items-center gap-3 py-2.5'>
              <View className='h-8 w-8 rounded-full bg-foreground/10' />
              <View className='flex-1 gap-2'>
                <View className='h-3.5 w-2/5 rounded-md bg-foreground/10' />
                <View className='h-3 w-1/4 rounded-md bg-foreground/5' />
              </View>
            </View>
          ))}
        </View>
      ) : displayRows.length === 0 ? (
        <View className='flex-1 items-center justify-center px-8'>
          <Text className='text-center text-secondary-foreground'>
            {isSearching ? 'No members match your search' : 'No members yet'}
          </Text>
        </View>
      ) : (
        <LegendList
          data={displayRows}
          keyExtractor={keyExtractor}
          estimatedItemSize={56}
          // Fill the remaining column space rather than sizing to content.
          // Matches dm-list / all-threads-list.
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 8 }}
          // No `maintainVisibleContentPosition`: it anchors scroll to a visible
          // item, which is for chat lists that prepend older messages
          // (chat-list / chat-thread). On a plain top-anchored list it re-anchors
          // on every data change and fights the user's scroll. No other plain
          // list here (dm-list, channels-list, activity, calls, tickets) uses it.
          recycleItems
          renderItem={renderItem}
        />
      )}

      <RemoveMemberSheet
        isPresented={removeTarget !== null}
        memberName={removeTarget?.name ?? ''}
        channelName={channelDisplayName}
        visibility={channel?.visibility}
        isRemoving={isRemoving}
        onDismiss={dismissRemove}
        onConfirm={confirmRemove}
      />
    </View>
  );
};

export default MembersScreen;
