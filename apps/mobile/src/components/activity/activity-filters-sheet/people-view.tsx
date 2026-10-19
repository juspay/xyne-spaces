import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useValue } from '@legendapp/state/react';
import { Bot, Check, ChevronLeft, Search, User } from 'lucide-react-native';
import { useState, type ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { InputV2 } from '@/src/components/ui/input-v2';
import { useActorPeople } from '@/src/features/activity/hooks/use-actor-people';
import {
  activityPreferences$,
  applyActivityPreferences,
  setActorUserId,
} from '@/src/features/activity/state/preferences-store';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import { HEADER_HEIGHT, ROW_HEIGHT } from './constants';

const AVATAR_SIZE = 36;

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
  const { accentText } = useBubbleAccent();

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected }}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      className='flex-row items-center rounded-xl px-2 active:bg-bottomsheet-container-bg'
      style={{ height: ROW_HEIGHT }}
    >
      <View className='items-center justify-center' style={{ width: AVATAR_SIZE }}>
        {leading}
      </View>
      <Text
        numberOfLines={1}
        className='ml-3 flex-1 text-[16px] font-medium text-bottomsheet-container-foreground'
        style={selected ? { color: accentText } : undefined}
      >
        {label}
      </Text>
      {selected ? <Check size={20} color={accentText} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

/** One step into the sheet: choose one person — or one agent — to narrow the feed to. */
export function PeopleView({ onBack }: { onBack: () => void }): ReactElement {
  const kind = useValue(activityPreferences$.actorKind);
  const selectedId = useValue(activityPreferences$.actorUserId);
  const foreground = useCSSVariable('--color-bottomsheet-container-foreground') as string;
  const muted = useCSSVariable('--color-bottomsheet-text-muted') as string;
  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const [query, setQuery] = useState('');
  // Android lifts the whole sheet above the navigation bar itself.
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'ios' ? insets.bottom : 0;

  const people = useActorPeople(kind, query, selectedId);

  const choose = (id: string | null): void => {
    setActorUserId(id);
    onBack();
    applyActivityPreferences();
  };

  const isAgent = kind === 'agent';
  const Icon = isAgent ? Bot : User;
  const title = isAgent ? 'Choose an agent' : 'Choose a person';
  const placeholder = isAgent ? 'Search agents' : 'Search people';

  return (
    <View className='flex-1 px-3'>
      <View className='flex-row items-center justify-center' style={{ height: HEADER_HEIGHT }}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Back to filters'
          hitSlop={10}
          onPress={() => {
            void haptics.buttonTap();
            onBack();
          }}
          className='absolute left-0 h-10 w-10 items-center justify-center rounded-full active:bg-bottomsheet-container-bg'
        >
          <ChevronLeft size={22} color={foreground} strokeWidth={2} />
        </Pressable>
        <Text className='text-[17px] font-semibold text-bottomsheet-text-header'>{title}</Text>
      </View>

      <View className='mt-1 px-1'>
        <InputV2
          value={query}
          onChangeText={setQuery}
          variant='bottomsheet'
          placeholder={placeholder}
          placeholderTextColor={placeholderColor}
          leftIcon={<Search size={18} color={placeholderColor} />}
          clearIconColor={placeholderColor}
          autoCapitalize='none'
          autoCorrect={false}
          returnKeyType='search'
          inputClassName='font-medium'
        />
      </View>

      <BottomSheetScrollView
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, marginTop: 8 }}
        contentContainerStyle={{ paddingBottom: 16 + bottomInset }}
      >
        <PersonRow
          label={isAgent ? 'Any agent' : 'Anyone'}
          selected={selectedId === null}
          leading={
            <View
              className='items-center justify-center rounded-full border border-dashed'
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderColor: muted }}
            >
              <Icon size={18} color={muted} strokeWidth={2} />
            </View>
          }
          onPress={() => choose(null)}
        />

        {people.map(person => (
          <PersonRow
            key={person.id}
            label={person.name}
            selected={person.id === selectedId}
            leading={<Avatar userIds={[person.id]} size={AVATAR_SIZE} />}
            onPress={() => choose(person.id)}
          />
        ))}

        {query.trim() !== '' && people.length === 0 ? (
          <Text className='px-3 py-6 text-center text-[15px] text-bottomsheet-text-muted'>
            No results
          </Text>
        ) : null}
      </BottomSheetScrollView>
    </View>
  );
}
