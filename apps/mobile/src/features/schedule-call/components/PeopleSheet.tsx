import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { ChannelScopeType, ChannelType } from '@xyne/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Hash, Search, Users } from 'lucide-react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import Avatar from '@/src/components/ui/avatar';
import { withAlpha } from '@/src/theme/accent-contrast';
import { useAllVisibleChannels } from '@/src/hooks/useChannels';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useUserPickerSearch } from '@/src/hooks/useUserPickerSearch';
import { useSelf } from '@/src/hooks/useUsers';
import { stateMachineActor } from '@/src/machines/stateMachine';
import { useZero } from '@/src/hooks/useZero';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { isUserDeactivated } from '@/src/utils/statusUtils';
import { showMessageToast } from '@/src/utils/toast';
import { queries } from '@/src/zero/queries';

import {
  NO_PARTICIPANTS,
  countParticipants,
  type ScheduleCallParticipants,
  type ScheduleCallUser,
} from '../hooks/useScheduleCallForm';

const LIST_LIMIT = 10;

type Tab = 'all' | 'invited';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'invited', label: 'Invited' },
];

export interface Row {
  id: string;
  title: string;
  subtitle?: string | undefined;
  selected: boolean;
  disabled?: boolean;
  leading: ReactElement;
  onPress: () => void;
}

/** A row, or a small heading that groups the rows below it. */
type ListEntry = Row | { id: string; header: string };

export const Tile = ({ children }: { children: ReactElement }): ReactElement => (
  <View className='size-10 items-center justify-center rounded-full bg-secondary'>{children}</View>
);

const OptionRowBase = ({ row }: { row: Row }): ReactElement => {
  const { accentBg, accentFg } = useBubbleAccent();
  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{ checked: row.selected, disabled: row.disabled === true }}
      disabled={row.disabled}
      onPress={() => {
        void haptics.selection();
        row.onPress();
      }}
      // A selected row gets a soft tint of the accent, as in the prototype.
      className={cn(
        'mx-2 min-h-15 flex-row items-center gap-3 rounded-2xl py-2 pl-3 pr-2.5 active:opacity-70',
        row.disabled && 'opacity-45',
      )}
      style={row.selected ? { backgroundColor: withAlpha(accentBg, 0.12) } : undefined}
    >
      {row.leading}
      <View className='min-w-0 flex-1'>
        <Text className='text-base font-medium text-bottomsheet-text-header' numberOfLines={1}>
          {row.title}
        </Text>
        {row.subtitle ? (
          <Text className='text-xs text-bottomsheet-text-muted' numberOfLines={1}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      <View
        className='size-6 items-center justify-center rounded-full border-2 border-muted'
        style={row.selected ? { backgroundColor: accentBg, borderColor: accentBg } : undefined}
      >
        {row.selected ? <Check size={14} strokeWidth={3.5} color={accentFg} /> : null}
      </View>
    </Pressable>
  );
};

// The row object is rebuilt on every list change, so compare what is drawn: toggling one person
// then re-renders that row only. (`leading` and `onPress` follow from the id, so they are not
// compared.)
export const OptionRow = memo(
  OptionRowBase,
  ({ row: a }, { row: b }) =>
    a.id === b.id &&
    a.selected === b.selected &&
    a.disabled === b.disabled &&
    a.title === b.title &&
    a.subtitle === b.subtitle,
);

const TabChip = ({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}): ReactElement => {
  const { accentBg, accentFg } = useBubbleAccent();
  return (
    <Pressable
      accessibilityRole='tab'
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-9 flex-row items-center gap-1.5 rounded-full px-3.5 active:opacity-80',
        active ? 'bg-foreground' : 'bg-secondary',
      )}
    >
      <Text className={cn('text-sm font-semibold', active ? 'text-background' : 'text-foreground')}>
        {label}
      </Text>
      {count > 0 ? (
        <View
          className='h-5 min-w-5 items-center justify-center rounded-full px-1.5'
          style={{ backgroundColor: accentBg }}
        >
          <Text className='text-xs font-bold' style={{ color: accentFg }}>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
};

interface PeopleSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once the sheet has finished closing; the form unmounts it then (see the screen). */
  onClosed: () => void;
  /** What the form holds now; the sheet edits a draft of it. */
  participants: ScheduleCallParticipants;
  /** Called with the draft when Done is tapped. Swiping the sheet away discards the draft. */
  onApply: (participants: ScheduleCallParticipants) => void;
  /** People who cannot be removed (participants-only edit). Channels are not offered then. */
  lockedUserIds?: ReadonlySet<string> | undefined;
}

/**
 * People, groups and channels in one sheet. People are individual picks; a group adds all of its
 * members as individual people; a channel is a single pick that replaces any people.
 */
export const PeopleSheet = ({
  isOpen,
  onOpenChange,
  onClosed,
  participants,
  onApply,
  lockedUserIds,
}: PeopleSheetProps): ReactElement => {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const { accentBg, accentFg } = useBubbleAccent();
  const zero = useZero();
  const self = useSelf();
  const allChannels = useAllVisibleChannels();
  const allGroups = useUserGroups();
  const mutedColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const iconColor = useCSSVariable('--color-settings-description') as string;
  const sheetBackground = useCSSVariable('--color-bottomsheet-bg') as string;

  // The sheet mounts fresh on every open (see the form screen), so it starts from the form's
  // selection with no reset step.
  const [draft, setDraft] = useState(participants);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  // Member ids of groups the user has tapped, so a group row can show as fully selected.
  const [groupMembers, setGroupMembers] = useState<Record<string, string[]>>({});
  // Rows picked before the sheet opened stay on top; new picks stay where they were tapped.
  const [pinnedIds] = useState(() => new Set(participants.users.map(u => u.id)));

  const dismiss = useCallback((): void => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismiss, isOpen]);

  const selectedIds = useMemo(() => new Set(draft.users.map(u => u.id)), [draft.users]);
  const search = useUserPickerSearch(query, 20, self?.id);

  const toUser = useCallback(
    (u: { id: string; name?: string | null; email?: string | null; picture?: string | null }) => ({
      id: u.id,
      name: u.name ?? u.email ?? '',
      email: u.email ?? '',
      picture: u.picture ?? null,
    }),
    [],
  );

  const toggleUser = useCallback(
    (user: ScheduleCallUser): void => {
      if (lockedUserIds?.has(user.id)) return;
      setDraft(prev => {
        const current = prev.channel ? [] : prev.users;
        const users = current.some(u => u.id === user.id)
          ? current.filter(u => u.id !== user.id)
          : [...current, user];
        return { users, channel: null };
      });
    },
    [lockedUserIds],
  );

  const toggleChannel = useCallback((picked: { id: string; name: string }): void => {
    setDraft(prev =>
      prev.channel?.id === picked.id
        ? NO_PARTICIPANTS
        : { users: [], channel: { id: picked.id, name: picked.name } },
    );
  }, []);

  /** Tapping a group selects every member as an individual; tapping it again clears them. */
  const toggleGroup = useCallback(
    async (groupId: string): Promise<void> => {
      let ids = groupMembers[groupId];
      if (!ids) {
        try {
          const rows = await zero.run(queries.getUserGroupMembers({ userGroupId: groupId }), {
            type: 'complete',
          });
          ids = rows.map(m => m.userId).filter(id => id !== self?.id);
          const loaded = ids;
          setGroupMembers(prev => ({ ...prev, [groupId]: loaded }));
        } catch {
          showMessageToast('Could not load group members', 'error');
          return;
        }
      }
      // Read once, on demand: subscribing to the whole workspace user list just for this would
      // re-render the sheet on every user update.
      const wanted = new Set(ids);
      const members = stateMachineActor
        .getSnapshot()
        .context.users.filter(u => wanted.has(u.id) && !isUserDeactivated(u))
        .map(toUser);
      setDraft(prev => {
        const current = prev.channel ? [] : prev.users;
        const have = new Set(current.map(u => u.id));
        const allIn = members.length > 0 && members.every(m => have.has(m.id));
        const memberIds = new Set(members.map(m => m.id));
        const users = allIn
          ? current.filter(u => !memberIds.has(u.id) || lockedUserIds?.has(u.id))
          : [...current, ...members.filter(m => !have.has(m.id))];
        return { users, channel: null };
      });
    },
    [groupMembers, lockedUserIds, self?.id, toUser, zero],
  );

  const q = query.trim().toLowerCase();

  const rows = useMemo((): ListEntry[] => {
    const peopleRows = (): Row[] => {
      const fromSearch = search.map(u => ({ user: toUser(u), deactivated: isUserDeactivated(u) }));
      const listed = new Set(fromSearch.map(r => r.user.id));
      const pinned = draft.users
        .filter(u => pinnedIds.has(u.id) && !listed.has(u.id))
        .map(user => ({ user, deactivated: false }));
      const ordered = q
        ? fromSearch
        : [
            ...pinned,
            ...fromSearch.filter(r => pinnedIds.has(r.user.id)),
            ...fromSearch.filter(r => !pinnedIds.has(r.user.id)),
          ];
      return ordered.map(({ user, deactivated }) => ({
        id: user.id,
        title: user.name,
        subtitle: deactivated ? 'Deactivated' : user.email,
        selected: selectedIds.has(user.id),
        disabled: deactivated || !!lockedUserIds?.has(user.id),
        leading: <Avatar userIds={[user.id]} size={40} />,
        onPress: () => toggleUser(user),
      }));
    };
    const groupRows = (): Row[] =>
      allGroups
        .filter(g => g.isActive !== false && g.name.toLowerCase().includes(q))
        .slice(0, LIST_LIMIT)
        .map(g => {
          const ids = groupMembers[g.id];
          return {
            id: g.id,
            title: g.name,
            subtitle: ids ? `${ids.length} members` : (g.description ?? 'Group'),
            selected: !!ids && ids.length > 0 && ids.every(id => selectedIds.has(id)),
            leading: (
              <Tile>
                <Users size={18} color={iconColor} />
              </Tile>
            ),
            onPress: () => void toggleGroup(g.id),
          };
        });
    // Real workspace channels only (no DMs, desks or email channels), as on the dashboard.
    const channelRows = (): Row[] =>
      allChannels
        .filter(
          c =>
            c.type === ChannelType.DEFAULT &&
            c.scopeType === ChannelScopeType.DEFAULT &&
            !c.isArchived &&
            c.name.toLowerCase().includes(q),
        )
        .slice(0, LIST_LIMIT)
        .map(c => ({
          id: c.id,
          title: c.name,
          subtitle: c.channelStats ? `${c.channelStats.participantCount} members` : undefined,
          selected: draft.channel?.id === c.id,
          leading: (
            <Tile>
              <Hash size={18} color={iconColor} />
            </Tile>
          ),
          onPress: () => toggleChannel(c),
        }));

    if (tab === 'invited') {
      const matches = (s: string): boolean => !q || s.toLowerCase().includes(q);
      const people = draft.users
        .filter(u => matches(u.name) || matches(u.email))
        .map((user): Row => ({
          id: user.id,
          title: user.name,
          subtitle: user.email,
          selected: true,
          disabled: !!lockedUserIds?.has(user.id),
          leading: <Avatar userIds={[user.id]} size={40} />,
          onPress: () => toggleUser(user),
        }));
      const channel = draft.channel;
      const picked: Row[] =
        channel && matches(channel.name)
          ? [
              {
                id: channel.id,
                title: channel.name,
                subtitle: 'Whole channel',
                selected: true,
                leading: (
                  <Tile>
                    <Hash size={18} color={iconColor} />
                  </Tile>
                ),
                onPress: () => toggleChannel(channel),
              },
            ]
          : [];
      return [...picked, ...people];
    }

    // All: one list, as the dashboard's single dropdown holds people, groups and channels together.
    const section = (title: string, items: Row[]): ListEntry[] =>
      items.length > 0 ? [{ id: `section:${title}`, header: title }, ...items] : [];
    return [
      ...section('People', peopleRows()),
      ...section('Groups', groupRows()),
      ...(lockedUserIds ? [] : section('Channels', channelRows())),
    ];
  }, [
    allChannels,
    allGroups,
    draft.channel,
    draft.users,
    groupMembers,
    iconColor,
    lockedUserIds,
    pinnedIds,
    q,
    search,
    selectedIds,
    tab,
    toUser,
    toggleChannel,
    toggleGroup,
    toggleUser,
  ]);

  const handleDone = useCallback((): void => {
    void haptics.buttonTap();
    onApply(draft);
    dismiss();
  }, [dismiss, draft, onApply]);

  const peopleCount = draft.users.length;
  const doneLabel = draft.channel
    ? `Done · #${draft.channel.name}`
    : peopleCount > 0
      ? `Done · ${peopleCount} invited`
      : 'Done';
  const emptyText = q ? 'No matches' : 'Nothing to show';

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps): ReactElement => (
      <BottomSheetFooter {...props}>
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} pointerEvents='box-none'>
          <View
            pointerEvents='box-none'
            className='px-4 pt-12'
            style={{ paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 12) : 12 }}
          >
            <LinearGradient
              colors={[withAlpha(sheetBackground, 0), sheetBackground]}
              locations={[0, 0.6]}
              pointerEvents='none'
              style={StyleSheet.absoluteFill}
            />
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Done'
              onPress={handleDone}
              className='h-12 items-center justify-center rounded-full active:opacity-80'
              style={{ backgroundColor: accentBg }}
            >
              <Text
                className='text-base font-semibold'
                style={{ color: accentFg }}
                numberOfLines={1}
              >
                {doneLabel}
              </Text>
            </Pressable>
          </View>
        </KeyboardStickyView>
      </BottomSheetFooter>
    ),
    [accentBg, accentFg, doneLabel, handleDone, insets.bottom, sheetBackground],
  );

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClose={onClosed}
      mode='fullscreen'
      footerComponent={renderFooter}
      keyboardBehavior='extend'
      backdropOpacity={0.4}
    >
      <View className='flex-1'>
        <Text className='px-5 pb-2.5 pt-1.5 text-xl font-bold text-bottomsheet-text-header'>
          Internal users
        </Text>

        <View className='mx-4 h-11 flex-row items-center gap-2.5 rounded-full bg-secondary px-4'>
          <Search size={17} color={mutedColor} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder='Search people, groups, channels'
            placeholderTextColor={mutedColor}
            accessibilityLabel='Search'
            autoCapitalize='none'
            autoCorrect={false}
            spellCheck={false}
            autoComplete='off'
            returnKeyType='search'
            cursorColor={accentBg}
            selectionColor={accentBg}
            className='min-w-0 flex-1 px-0 py-0 text-base text-foreground'
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps='handled'
          className='grow-0'
          contentContainerClassName='gap-1.5 px-4 pb-1 pt-3'
        >
          {TABS.map(t => (
            <TabChip
              key={t.id}
              label={t.label}
              count={t.id === 'invited' ? countParticipants(draft) : 0}
              active={tab === t.id}
              onPress={() => {
                setTab(t.id);
                setQuery('');
              }}
            />
          ))}
        </ScrollView>

        <View className='flex-1' style={{ minHeight: 0 }}>
          {rows.length === 0 && tab === 'invited' && !q ? (
            <View className='items-center gap-4 pt-14'>
              <Text className='text-base text-bottomsheet-text-muted'>No one invited yet</Text>
              <Pressable
                accessibilityRole='button'
                onPress={() => setTab('all')}
                className='h-11 justify-center rounded-full bg-secondary px-6 active:opacity-70'
              >
                <Text className='text-base font-semibold text-bottomsheet-text-header'>
                  Browse people
                </Text>
              </Pressable>
            </View>
          ) : rows.length === 0 ? (
            <Text className='py-8 text-center text-bottomsheet-text-muted'>{emptyText}</Text>
          ) : (
            <BottomSheetFlatList
              style={{ flex: 1 }}
              data={rows}
              keyExtractor={row => row.id}
              renderItem={({ item }) =>
                'header' in item ? (
                  <Text className='px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-bottomsheet-text-muted'>
                    {item.header}
                  </Text>
                ) : (
                  <OptionRow row={item} />
                )
              }
              ListHeaderComponent={<View className='h-3' />}
              ListFooterComponent={<View className='h-36' />}
              keyboardShouldPersistTaps='handled'
              keyboardDismissMode='on-drag'
              showsVerticalScrollIndicator={false}
            />
          )}
          <View className='pointer-events-none absolute inset-x-0 top-0 h-4'>
            <LinearGradient
              colors={[sheetBackground, withAlpha(sheetBackground, 0)]}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>
      </View>
    </AppBottomSheet>
  );
};
