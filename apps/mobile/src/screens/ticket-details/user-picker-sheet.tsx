import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Check, Search, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import type { User } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { InputV2 } from '@/src/components/ui/input-v2';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { isUserDeactivated } from '@/src/utils/statusUtils';

import { TicketMetaPickerSheet } from './ticket-meta-picker-sheet';
import { useAssigneePickerCandidates } from './use-assignee-picker-candidates';

const ROW_HEIGHT = 68;

type UserPickerSheetProps = {
  isOpen: boolean;
  channelId: string;
  userGroupId?: string | null;
  /** Bare user id of the current selection (prefix stripped). */
  selectedUserId: string | null;
  /**
   * True only when the ticket has no assignee (not a user and not a group).
   * Group assignments must pass `false` so Unassigned is not marked selected.
   */
  isUnassigned?: boolean;
  onClose: () => void;
  /** Pass `null` to clear the assignee (Unassigned). */
  onSelect: (userId: string | null) => void;
  /** Sheet header title. Defaults to "Assignee". */
  title?: string;
  /** Show a pinned "Unassigned" row (dashboard AssigneePicker parity). Default true. */
  allowUnassign?: boolean;
};

type UserPickerRowProps = {
  user: User;
  isSelected: boolean;
  onPress: (userId: string) => void;
};

const UserPickerRow = memo(function UserPickerRow({
  user,
  isSelected,
  onPress,
}: UserPickerRowProps): ReactElement {
  const { accentBg } = useBubbleAccent();
  const displayName = getUserDisplayName(user);
  const deactivated = isUserDeactivated(user);
  const email = user.email?.trim() || '';

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={displayName}
      onPress={() => onPress(user.id)}
      style={{ height: ROW_HEIGHT }}
      className='flex-row items-center gap-3.5 px-4 active:opacity-70'
    >
      <Avatar userIds={[user.id]} size={40} />
      <View className='min-w-0 flex-1 justify-center'>
        <View className='flex-row items-center gap-2'>
          <Text
            className={cn(
              'min-w-0 shrink text-[16px] font-normal',
              deactivated ? 'text-foreground/40' : 'text-foreground',
            )}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {deactivated ? (
            <View className='rounded px-1.5 py-0.5 bg-foreground/28'>
              <Text className='text-[11px] text-foreground/70'>Deactivated</Text>
            </View>
          ) : null}
        </View>
        {email ? (
          <Text className='mt-0.5 text-[14px] text-foreground/40' numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
      {isSelected ? <Check size={18} color={accentBg} strokeWidth={2.5} /> : null}
    </Pressable>
  );
});

const UnassignedRow = memo(function UnassignedRow({
  isSelected,
  onPress,
}: {
  isSelected: boolean;
  onPress: () => void;
}): ReactElement {
  const { accentBg } = useBubbleAccent();
  const muted = useCSSVariable('--color-muted') as string;
  const secondaryBg = useCSSVariable('--color-secondary') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel='Unassigned'
      onPress={onPress}
      style={{ height: ROW_HEIGHT }}
      className='flex-row items-center gap-3.5 px-4 active:opacity-70'
    >
      <View
        className='size-10 items-center justify-center rounded-lg'
        style={{ backgroundColor: secondaryBg }}
      >
        <X size={18} color={muted} strokeWidth={2.25} />
      </View>
      <Text className='min-w-0 flex-1 text-[16px] font-normal text-foreground' numberOfLines={1}>
        Unassigned
      </Text>
      {isSelected ? <Check size={18} color={accentBg} strokeWidth={2.5} /> : null}
    </Pressable>
  );
});

/**
 * Fullscreen single-select drawer of channel and/or assignment-group members.
 * Presentation/dismissal shell comes from TicketMetaPickerSheet.
 */
export function UserPickerSheet({
  isOpen,
  channelId,
  userGroupId,
  selectedUserId,
  isUnassigned = selectedUserId == null,
  onClose,
  onSelect,
  title = 'Assignee',
  allowUnassign = true,
}: UserPickerSheetProps): ReactElement {
  const inputRef = useRef<TextInput>(null);
  const muted = useCSSVariable('--color-muted') as string;
  const [query, setQuery] = useState('');
  const { candidates, emptyLabel } = useAssigneePickerCandidates({
    channelId,
    userGroupId: userGroupId ?? null,
    query,
    selectedUserId,
  });

  useEffect(() => {
    if (!isOpen) {
      inputRef.current?.blur();
      setQuery('');
    }
  }, [isOpen]);

  const handleSelect = useCallback(
    (userId: string | null, dismiss: () => void): void => {
      void haptics.selection();
      onSelect(userId);
      dismiss();
    },
    [onSelect],
  );

  return (
    <TicketMetaPickerSheet isOpen={isOpen} title={title} onClose={onClose}>
      {({ dismiss }) => (
        <View className='min-h-0 flex-1'>
          <View className='px-4 pb-2'>
            <InputV2
              inputRef={inputRef}
              value={query}
              onChangeText={setQuery}
              variant='bottomsheet'
              placeholder='Search members'
              placeholderTextColor={muted}
              autoCorrect={false}
              autoCapitalize='none'
              returnKeyType='search'
              leftIcon={<Search size={18} color={muted} />}
            />
          </View>

          <BottomSheetFlatList
            data={candidates}
            keyExtractor={(item: User) => item.id}
            ListHeaderComponent={
              allowUnassign ? (
                <UnassignedRow
                  isSelected={isUnassigned}
                  onPress={() => handleSelect(null, dismiss)}
                />
              ) : null
            }
            renderItem={({ item }: { item: User }) => (
              <UserPickerRow
                user={item}
                isSelected={item.id === selectedUserId}
                onPress={userId => handleSelect(userId, dismiss)}
              />
            )}
            keyboardShouldPersistTaps='handled'
            keyboardDismissMode='on-drag'
            contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
            ListEmptyComponent={
              allowUnassign ? null : (
                <View className='flex-1 items-center justify-center px-6 pt-10'>
                  <Text className='text-center text-[15px] text-secondary-foreground'>
                    {emptyLabel}
                  </Text>
                </View>
              )
            }
          />
        </View>
      )}
    </TicketMetaPickerSheet>
  );
}
