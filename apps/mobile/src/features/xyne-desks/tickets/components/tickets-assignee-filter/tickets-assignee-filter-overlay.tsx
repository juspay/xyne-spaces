import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { LegendList } from '@legendapp/list/react-native';
import { Check, X } from 'lucide-react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useUsers } from '@/src/hooks/useUsers';
import type { User } from '@xyne/shared';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { cn } from '@/src/utils/cn';
import { isUserDeactivated } from '@/src/utils/statusUtils';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import {
  TICKETS_ASSIGNEE_FILTER_DEFAULT_LIMIT,
  TICKETS_ASSIGNEE_FILTER_SEARCH_LIMIT,
} from '../../constants';
import { HeaderIconButton } from '@/src/components/ui/header-icon-button';

const ASSIGNEE_ROW_HEIGHT = 68;
const FOOTER_ACTIONS_HEIGHT = 52;

type TicketsAssigneeFilterOverlayProps = {
  progress: SharedValue<number>;
  isOpen: boolean;
  /** Header title — e.g. "Assignee" / "Created by". */
  title?: string;
  /** Currently applied assignee ids (synced into draft when overlay opens). */
  selectedIds: readonly string[];
  onClose: () => void;
  /** Persist draft selection (Save) or empty list (Clear), then parent closes. */
  onApply: (userIds: string[]) => void;
};

type AssigneeRowProps = {
  user: User;
  isSelected: boolean;
  onToggle: (userId: string) => void;
};

const AssigneeRow = memo(function AssigneeRow({ user, isSelected, onToggle }: AssigneeRowProps) {
  const { accentBg, accentFg } = useBubbleAccent();
  const checkColor = accentFg;
  const displayName = getUserDisplayName(user);
  const deactivated = isUserDeactivated(user);
  const email = user.email?.trim() || '';

  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={displayName}
      onPress={() => onToggle(user.id)}
      style={{ height: ASSIGNEE_ROW_HEIGHT }}
      className='flex-row items-center gap-3.5 px-4 active:opacity-70'
    >
      <Avatar userIds={[user.id]} size={40} rounded />
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
      <View
        className={cn(
          'size-5 items-center justify-center rounded-full border-2',
          isSelected ? '' : 'border-foreground/30 bg-transparent',
        )}
        style={isSelected ? { borderColor: accentBg, backgroundColor: accentBg } : undefined}
      >
        {isSelected ? <Check size={12} color={checkColor} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
});

function buildAssigneeCandidates(
  users: User[],
  usersById: Map<string, User>,
  selectedIds: readonly string[],
  searchTerm: string,
): User[] {
  const selectedSet = new Set(selectedIds);
  const searchLower = searchTerm.toLowerCase().trim();

  let baseUsers: User[];

  if (searchLower) {
    baseUsers = users.filter(user => {
      const displayName = getUserDisplayName(user).toLowerCase();
      return (
        displayName.includes(searchLower) ||
        user.name.toLowerCase().includes(searchLower) ||
        user.email?.toLowerCase().includes(searchLower)
      );
    });
  } else {
    const idSet = new Set<string>();
    const list: User[] = [];

    for (const userId of selectedIds) {
      if (idSet.has(userId)) continue;
      const user = usersById.get(userId);
      if (user) {
        idSet.add(userId);
        list.push(user);
      }
    }

    let added = 0;
    for (const user of users) {
      if (idSet.has(user.id)) continue;
      idSet.add(user.id);
      list.push(user);
      added += 1;
      if (added >= TICKETS_ASSIGNEE_FILTER_DEFAULT_LIMIT) break;
    }
    baseUsers = list;
  }

  return baseUsers
    .sort((a, b) => {
      const aSel = selectedSet.has(a.id) ? 1 : 0;
      const bSel = selectedSet.has(b.id) ? 1 : 0;
      if (bSel !== aSel) return bSel - aSel;
      return getUserDisplayName(a).localeCompare(getUserDisplayName(b));
    })
    .slice(0, TICKETS_ASSIGNEE_FILTER_SEARCH_LIMIT);
}

/**
 * Full-screen Assignee filter overlay — Gmail "From/To" picker layout + multi-select.
 * Single flat surface (no header/footer card backgrounds). Draft until Save / Clear.
 */
export const TicketsAssigneeFilterOverlay = memo(function TicketsAssigneeFilterOverlay({
  progress,
  isOpen,
  title = 'Assignee',
  selectedIds,
  onClose,
  onApply,
}: TicketsAssigneeFilterOverlayProps) {
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const { accentBg: saveBg, accentFg: saveFg } = useBubbleAccent();
  const { theme } = useUniwind();
  const iconColor = theme === 'dark' ? '#FFFFFF' : '#000000';
  const muted = useCSSVariable('--color-muted') as string;

  const users = useUsers();
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [draftIds, setDraftIds] = useState<string[]>(() => [...selectedIds]);

  const footerBottomPad = Math.max(insets.bottom, 10);
  const listBottomPad = FOOTER_ACTIONS_HEIGHT + footerBottomPad + 12;

  // Debounce search like dashboard UserSubmenu.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset draft + search when opening.
  useEffect(() => {
    if (!isOpen) {
      inputRef.current?.blur();
      return;
    }
    setDraftIds([...selectedIds]);
    setQuery('');
    setSearchTerm('');
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [isOpen, selectedIds]);

  const candidates = useMemo(
    () => buildAssigneeCandidates(users, usersById, draftIds, searchTerm),
    [users, usersById, draftIds, searchTerm],
  );

  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [18, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const handleToggle = useCallback((userId: string) => {
    setDraftIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId],
    );
  }, []);

  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    onApply(draftIds);
  }, [draftIds, onApply]);

  const handleClear = useCallback(() => {
    Keyboard.dismiss();
    onApply([]);
  }, [onApply]);

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <AssigneeRow user={item} isSelected={draftSet.has(item.id)} onToggle={handleToggle} />
    ),
    [draftSet, handleToggle],
  );

  const keyExtractor = useCallback((item: User) => item.id, []);
  const getFixedItemSize = useCallback(() => ASSIGNEE_ROW_HEIGHT, []);

  const listEmpty = (
    <View className='items-center px-6 py-16'>
      <Text className='text-[15px] text-foreground'>
        {query.trim() ? 'No matches found' : 'No users available'}
      </Text>
    </View>
  );

  const canClear = draftIds.length > 0 || selectedIds.length > 0;
  const canSave = draftIds.length > 0;

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex: 70 }, rootStyle]}
      className='bg-neutral-100 dark:bg-tabs-screen'
    >
      {/* Header + search — same surface as body (Gmail) */}
      <View style={{ paddingTop: topSafeHeight }}>
        <View style={{ height: headerHeight }} className='flex-row items-center px-1'>
          <HeaderIconButton
            liquidGlass
            accessibilityLabel={`Close ${title} filter`}
            onPress={handleClose}
          >
            <X size={22} color={iconColor} strokeWidth={2} />
          </HeaderIconButton>
          <Text className='text-[20px] font-normal text-foreground'>{title}</Text>
          {selectedIds.length > 0 ? (
            <View className='flex-row items-center gap-2 ml-2'>
              <Text className='text-[15px] font-medium text-foreground'>
                • {selectedIds.length} selected
              </Text>
            </View>
          ) : null}
        </View>

        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder='Type a name or email address'
          placeholderTextColor={muted}
          className='px-4 pb-3 pt-1 text-[16px] text-foreground'
          autoCorrect={false}
          autoCapitalize='none'
          returnKeyType='search'
          clearButtonMode='while-editing'
        />
        <View className='mx-4 h-px bg-foreground/12' />
      </View>

      <LegendList
        data={candidates}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        recycleItems
        getFixedItemSize={getFixedItemSize}
        estimatedItemSize={ASSIGNEE_ROW_HEIGHT}
        ListEmptyComponent={listEmpty}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        extraData={draftSet}
        style={styles.list}
        contentContainerStyle={
          candidates.length === 0
            ? styles.emptyContent
            : { paddingTop: 8, paddingBottom: listBottomPad }
        }
        className='bg-neutral-100 dark:bg-tabs-screen'
      />

      {/* Sticky above keyboard — same bg, no card chrome */}
      <KeyboardStickyView
        offset={{ closed: 0, opened: insets.bottom - 2 }}
        style={styles.stickyFooter}
      >
        <View
          style={{ paddingBottom: footerBottomPad }}
          className='flex-row gap-3 bg-neutral-100 px-4 pt-2 dark:bg-tabs-screen'
        >
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Clear assignee filter'
            disabled={!canClear}
            onPress={handleClear}
            className={cn(
              'flex-1 items-center justify-center rounded-full border border-foreground/20 py-3 active:opacity-70',
              !canClear && 'opacity-40',
            )}
          >
            <Text className='text-[15px] font-medium text-foreground'>Clear</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Save assignee filter'
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={handleSave}
            className={cn(
              'flex-1 items-center justify-center rounded-full py-3 active:opacity-80',
              !canSave && 'opacity-40',
            )}
            style={{ backgroundColor: saveBg }}
          >
            <Text className='text-[15px] font-medium' style={{ color: saveFg }}>
              Save
            </Text>
          </Pressable>
        </View>
      </KeyboardStickyView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  emptyContent: {
    flexGrow: 1,
  },
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
