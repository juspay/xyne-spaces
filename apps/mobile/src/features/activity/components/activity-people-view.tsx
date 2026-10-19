import { useValue } from '@legendapp/state/react';
import { Bot, Check, Search, User } from 'lucide-react-native';
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useActiveUsers } from '@xyne/shared/hooks';

import { Avatar } from '@/src/ui';
import { useTray } from '@/src/ui/tray';
import { BackHeader, TRAY_ROW_HEIGHT } from '@/src/ui/tray/parts';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { AGENT_ACTOR_TYPES, USER_ACTOR_TYPES } from '../domain/activityActorFilter';
import {
  activityPreferences$,
  applyActivityPreferences,
  setActorUserId,
} from '../state/preferences-store';

/** Enough to choose from without a long list to render; search reaches the rest. */
const PEOPLE_LIMIT = 15;
const AVATAR_SIZE = 36;

type Person = {
  id: string;
  name: string;
  /** Lowercased name, the key the list is sorted by. */
  sortKey: string;
  haystack: string;
};

/**
 * Ordered by code unit, on a key built once per person.
 *
 * Not `localeCompare`: on Android, Hermes calls into ICU for every comparison,
 * and a workspace's worth of names sorted that way takes seconds. A plain
 * comparison of precomputed keys takes a few milliseconds. The cost is that
 * accented names sort by code point rather than by locale rules.
 */
const bySortKey = (a: Person, b: Person): number =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;

function PersonRow({
  label,
  selected,
  leading,
  onPress,
}: {
  label: string;
  selected: boolean;
  leading: ReactElement;
  onPress: () => void;
}): ReactElement {
  const accent = useCSSVariable('--color-spaces-accent') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected }}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      className='flex-row items-center rounded-2xl px-3 active:bg-spaces-surface'
      style={{ height: TRAY_ROW_HEIGHT }}
    >
      <View className='items-center justify-center' style={{ width: AVATAR_SIZE }}>
        {leading}
      </View>
      <Text
        numberOfLines={1}
        className={cn(
          'ml-3 flex-1 text-[16px] font-medium',
          selected ? 'text-spaces-accent' : 'text-spaces-foreground',
        )}
      >
        {label}
      </Text>
      {selected ? <Check size={20} color={accent} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

/**
 * Choose one person — or one agent — to narrow the feed to.
 *
 * Shows a short, name-sorted list, with whoever is chosen kept at the top so
 * the tick is always on screen. Typing searches the whole set rather than
 * filtering the short list.
 */
export function ActivityPeopleView(): ReactElement {
  const { goBack } = useTray();
  const kind = useValue(activityPreferences$.actorKind);
  const selectedId = useValue(activityPreferences$.actorUserId);
  const users = useActiveUsers();

  const muted = useCSSVariable('--color-spaces-muted') as string;
  const [query, setQuery] = useState('');

  const isAgent = kind === 'agent';
  const types = isAgent ? AGENT_ACTOR_TYPES : USER_ACTOR_TYPES;

  const pool = useMemo<Person[]>(
    () =>
      users
        .filter(user => types.includes(user.userType))
        .map(user => {
          const name = getUserDisplayName(user);
          const sortKey = name.toLowerCase();
          return {
            id: user.id,
            name,
            sortKey,
            haystack: `${sortKey} ${user.email ?? ''}`.toLowerCase(),
          };
        })
        .sort(bySortKey),
    [types, users],
  );

  const visible = useMemo<Person[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle !== '') {
      return pool.filter(person => person.haystack.includes(needle)).slice(0, PEOPLE_LIMIT);
    }
    const head = pool.slice(0, PEOPLE_LIMIT);
    if (selectedId === null || head.some(person => person.id === selectedId)) return head;
    const selected = pool.find(person => person.id === selectedId);
    return selected !== undefined ? [selected, ...head] : head;
  }, [pool, query, selectedId]);

  const choose = (id: string | null): void => {
    setActorUserId(id);
    // Back first, so the card starts morphing; the morph is native, so the
    // feed's work beside it does not hold it up. A choice has no control
    // animation of its own to wait on, unlike the switches and segments.
    goBack();
    applyActivityPreferences();
  };

  const Icon = isAgent ? Bot : User;
  const title = isAgent ? 'Choose an agent' : 'Choose a person';
  const placeholder = isAgent ? 'Search agents' : 'Search people';

  return (
    <View className='px-3 pt-4 pb-3' style={{ flexShrink: 1 }}>
      <BackHeader title={title} onBack={goBack} />

      <View className='h-11 flex-row items-center rounded-full bg-spaces-surface px-4'>
        <Search size={18} color={muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={muted}
          autoCapitalize='none'
          autoCorrect={false}
          returnKeyType='search'
          accessibilityLabel={placeholder}
          className='ml-2 flex-1 text-[16px] text-spaces-foreground'
        />
      </View>

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps='handled'
        style={{ flexShrink: 1, marginTop: 8 }}
      >
        <PersonRow
          label={isAgent ? 'Any agent' : 'Anyone'}
          selected={selectedId === null}
          leading={
            <View
              className='items-center justify-center rounded-full border border-dashed border-spaces-muted'
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            >
              <Icon size={18} color={muted} strokeWidth={2} />
            </View>
          }
          onPress={() => choose(null)}
        />

        {visible.map(person => (
          <PersonRow
            key={person.id}
            label={person.name}
            selected={person.id === selectedId}
            leading={<Avatar userIds={[person.id]} size={AVATAR_SIZE} />}
            onPress={() => choose(person.id)}
          />
        ))}

        {query.trim() !== '' && visible.length === 0 ? (
          <Text className='px-3 py-6 text-center text-[15px] text-spaces-muted'>No results</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
