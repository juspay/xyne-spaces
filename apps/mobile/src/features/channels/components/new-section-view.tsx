import { useMemo, useState, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';

import { sectionNameError } from '@/src/components/chat/channel-list/section-sheet-parts';
import { useTray } from '@/src/ui/tray';
import { haptics } from '@/src/utils/haptics';

import { useChannelActions } from '../hooks/use-channel-actions';
import {
  ChannelOption,
  NameInput,
  PillButton,
  useChannelIds,
  useChannelSelection,
} from './section-tray-parts';

export const NEW_SECTION_VIEW = 'new-section';

/**
 * Name the section, pick any channels to put in it, create.
 *
 * Create is not inside the scroller: the list above it can be long and the
 * button has to stay where the thumb is. It is part of the view rather than the
 * tray's footer because the footer is shared across views and the picker has
 * no use for it.
 */
export function NewSectionView(): ReactElement {
  const { close } = useTray();
  const { createSection, existingSectionNames } = useChannelActions();

  const [name, setName] = useState('');
  const [selected, toggle] = useChannelSelection();
  const ids = useChannelIds();

  const trimmed = name.trim();
  // An empty name is the resting state, not an error worth shouting about:
  // the button being inert already says it.
  const error = useMemo(
    () => (trimmed.length === 0 ? null : sectionNameError(name, [...existingSectionNames])),
    [existingSectionNames, name, trimmed.length],
  );
  const canCreate = trimmed.length > 0 && error === null;

  const create = (): void => {
    if (!canCreate) return;
    void haptics.success();
    createSection(trimmed, [...selected]);
    close();
  };

  return (
    <View className='px-3 pt-5 pb-3' style={{ flexShrink: 1 }}>
      <NameInput value={name} onChangeText={setName} onSubmitEditing={create} error={error} />

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
        <PillButton label='Create section' disabled={!canCreate} onPress={create} />
      </View>
    </View>
  );
}
