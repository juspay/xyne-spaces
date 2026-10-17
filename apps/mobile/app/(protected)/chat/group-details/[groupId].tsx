import { LegendList } from '@legendapp/list/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X, Search } from 'lucide-react-native';
import { memo, type ReactElement, useCallback, useMemo, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { UserResponsibility } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useUsers } from '@/src/hooks/useUsers';
import { useOpenUserDm } from '@/src/components/conversation-composer/utils/useOpenUserDm';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';
import { HeaderIconButton } from '@/src/components/ui/header-icon-button';

type MemberRow = {
  userId: string;
  name: string;
  picture: string;
  email: string;
  responsibility: UserResponsibility;
};

const RESPONSIBILITY_PRIORITY: Record<UserResponsibility, number> = {
  [UserResponsibility.MANAGER]: 0,
  [UserResponsibility.TEAM_LEAD]: 1,
  [UserResponsibility.MEMBER]: 2,
  [UserResponsibility.PR_REVIEWER]: 3,
  [UserResponsibility.QA]: 4,
};

const getResponsibilityLabel = (responsibility: UserResponsibility): string => {
  if (responsibility === UserResponsibility.MANAGER) return 'Manager';
  if (responsibility === UserResponsibility.TEAM_LEAD) return 'Team Lead';
  if (responsibility === UserResponsibility.PR_REVIEWER) return 'Reviewer';
  if (responsibility === UserResponsibility.QA) return 'QA';
  return 'Member';
};

const getResponsibilityBadgeClassName = (responsibility: UserResponsibility): string => {
  if (responsibility === UserResponsibility.MANAGER) return 'bg-purple-100 text-purple-700';
  if (responsibility === UserResponsibility.TEAM_LEAD) return 'bg-blue-100 text-blue-700';
  return 'bg-muted text-muted-foreground';
};

const MemberItem = memo(
  ({
    item,
    onPressUser,
  }: {
    item: MemberRow;
    onPressUser: (userId: string) => void;
  }): ReactElement => {
    return (
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Message ${item.name}`}
        onPress={() => onPressUser(item.userId)}
        className='flex-row items-center gap-3 px-4 py-2.5 border-b border-border active:bg-muted'
      >
        <Avatar userIds={[item.userId]} size={32} />
        <View className='flex-1 min-w-0'>
          <Text className='text-sm font-medium text-foreground' numberOfLines={1}>
            {item.name}
          </Text>
          {item.email ? (
            <CopyableValue
              value={item.email}
              textClassName='text-xs text-secondary-foreground'
              copyAccessibilityLabel='Copy email address'
            />
          ) : null}
        </View>
        <View
          className={`rounded px-2 py-0.5 shrink-0 ${getResponsibilityBadgeClassName(item.responsibility)}`}
        >
          <Text className='text-[12px] font-medium' numberOfLines={1}>
            {getResponsibilityLabel(item.responsibility)}
          </Text>
        </View>
      </Pressable>
    );
  },
);
MemberItem.displayName = 'GroupDetails.MemberItem';

const GroupDetailsScreen = (): ReactElement => {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mutedForegroundColor = useCSSVariable('--color-secondary-foreground') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const [searchQuery, setSearchQuery] = useState('');
  const { openUserDm } = useOpenUserDm();

  const allUserGroups = useUserGroups();
  const [mappings] = useCachedQuery(queries.getUserGroupMembers({ userGroupId: groupId ?? '' }), {
    enabled: !!groupId,
  });
  const users = useUsers();

  const group = useMemo(() => allUserGroups.find(g => g.id === groupId), [allUserGroups, groupId]);

  const usersById = useMemo(() => {
    return new Map(users.map(user => [user.id, user]));
  }, [users]);

  const rows = useMemo<MemberRow[]>(() => {
    const mapped = (mappings ?? [])
      .map(mapping => {
        if (!mapping.userId) return null;
        const user = usersById.get(mapping.userId);
        if (!user) return null;
        return {
          userId: user.id,
          name: user.name ?? 'Unknown',
          picture: user.picture ?? '',
          email: user.email ?? '',
          responsibility: mapping.responsibility ?? UserResponsibility.MEMBER,
        };
      })
      .filter((item): item is MemberRow => item !== null);

    return mapped.sort((a, b) => {
      const byResponsibility =
        RESPONSIBILITY_PRIORITY[a.responsibility] - RESPONSIBILITY_PRIORITY[b.responsibility];
      if (byResponsibility !== 0) return byResponsibility;
      return a.name.localeCompare(b.name);
    });
  }, [mappings, usersById]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      row => row.name.toLowerCase().includes(q) || row.email.toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  const keyExtractor = useCallback((item: MemberRow): string => item.userId, []);
  const handlePressUser = useCallback(
    (userId: string): void => {
      void openUserDm(userId);
    },
    [openUserDm],
  );
  const renderItem = useCallback(
    ({ item }: { item: MemberRow }): ReactElement => (
      <MemberItem item={item} onPressUser={handlePressUser} />
    ),
    [handlePressUser],
  );

  return (
    <View className='flex-1 bg-background' style={{ paddingTop: insets.top }}>
      <View
        className='flex-row items-center justify-between px-4 py-3'
        onTouchStart={Keyboard.dismiss}
      >
        <View className='min-w-0 flex-1 pr-3'>
          <Text className='text-lg font-semibold text-foreground' numberOfLines={1}>
            {group?.alias || group?.name || 'Group members'}
          </Text>
          <Text className='text-sm text-secondary-foreground'>
            {rows.length} {rows.length === 1 ? 'member' : 'members'}
          </Text>
        </View>
        <HeaderIconButton liquidGlass accessibilityLabel='Close' onPress={() => router.back()}>
          <X size={22} color={foregroundColor} />
        </HeaderIconButton>
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
            placeholder='Search members'
            placeholderTextColor={mutedForegroundColor}
            className='flex-1 h-10 pl-11 pr-10 rounded-xl bg-foreground/5 text-[17px] text-foreground font-medium'
            style={{ paddingVertical: 0, textAlignVertical: 'center', includeFontPadding: false }}
            autoCorrect={false}
            autoCapitalize='none'
            returnKeyType='search'
          />
          {searchQuery.length > 0 ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              className='absolute right-3 justify-center p-1'
              style={{ top: 0, bottom: 0 }}
            >
              <X size={16} color={mutedForegroundColor} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {rows.length === 0 ? (
        <View className='flex-1 items-center justify-center px-8'>
          <Text className='text-center text-secondary-foreground'>No members found</Text>
        </View>
      ) : filteredRows.length === 0 ? (
        <View className='flex-1 items-center justify-center px-8'>
          <Text className='text-center text-secondary-foreground'>
            No members match your search
          </Text>
        </View>
      ) : (
        <LegendList
          data={filteredRows}
          keyExtractor={keyExtractor}
          estimatedItemSize={56}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 8 }}
          maintainVisibleContentPosition
          recycleItems
          renderItem={renderItem}
        />
      )}
    </View>
  );
};

export default GroupDetailsScreen;
