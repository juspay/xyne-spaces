import { useValue } from '@legendapp/state/react';
import { Search } from 'lucide-react-native';
import { useMemo, useState, type ReactElement } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useTray } from '@/src/ui/tray';
import { haptics } from '@/src/utils/haptics';

import { useChannelActions } from '../hooks/use-channel-actions';
import { channelAllIds$, channelRow$ } from '../state/rows-store';
import { useManagedSection } from './section-options-view';
import {
  BackHeader,
  ChannelOption,
  PillButton,
  useChannelIds,
  useChannelSelection,
} from './section-tray-parts';

/**
 * Which channels belong to the section.
 *
 * Seeded once from what the section holds now and then owned by the person
 * editing, so a sync landing mid-edit cannot undo a tick. Save is dead until
 * something changed, and also while nothing is selected: a section emptied here
 * is what Delete is for.
 */
export function ManageChannelsView(): ReactElement {
  const { close, goBack } = useTray();
  const { updateSectionChannels } = useChannelActions();
  const section = useManagedSection();

  const muted = useCSSVariable('--color-spaces-muted') as string;
  const [query, setQuery] = useState('');

  const allIds = useValue(channelAllIds$);
  const original = useMemo(
    () =>
      section === null ? [] : allIds.filter(id => channelRow$(id).sectionId.peek() === section.id),
    // Read once: the selection is seeded from this and must not move under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [selected, toggle] = useChannelSelection(original);
  const ids = useChannelIds(query);

  const { toAdd, toRemove } = useMemo(() => {
    const before = new Set(original);
    return {
      toAdd: [...selected].filter(id => !before.has(id)),
      toRemove: original.filter(id => !selected.has(id)),
    };
  }, [original, selected]);

  const canSave = selected.size > 0 && (toAdd.length > 0 || toRemove.length > 0);

  const save = (): void => {
    if (!canSave || section === null) return;
    void haptics.success();
    updateSectionChannels(section.id, toAdd, toRemove);
    close();
  };

  return (
    <View className='px-3 pt-4 pb-3' style={{ flexShrink: 1 }}>
      <BackHeader title={`Manage ${section?.name ?? ''} channels`} onBack={goBack} />

      <View className='h-11 flex-row items-center rounded-full bg-spaces-surface px-4'>
        <Search size={18} color={muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder='Search channels'
          placeholderTextColor={muted}
          autoCapitalize='none'
          autoCorrect={false}
          returnKeyType='search'
          accessibilityLabel='Search channels'
          className='ml-2 flex-1 text-[16px] text-spaces-foreground'
        />
      </View>

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps='handled'
        style={{ flexShrink: 1, marginTop: 8 }}
      >
        {ids.map(id => (
          <ChannelOption key={id} id={id} checked={selected.has(id)} onToggle={toggle} />
        ))}
      </ScrollView>

      <View className='mt-3'>
        <PillButton label='Save' disabled={!canSave} onPress={save} />
      </View>
    </View>
  );
}
