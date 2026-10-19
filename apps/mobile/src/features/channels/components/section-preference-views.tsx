import { type ReactElement } from 'react';
import { View } from 'react-native';

import {
  CHANNEL_FILTER_OPTIONS,
  CHANNEL_SORT_OPTIONS,
} from '@/src/components/chat/channel-list/channel-group-preferences';
import { useTray } from '@/src/ui/tray';

import { useGroupPreference } from '../hooks/use-group-preference';
import { BackHeader, OptionRow, Radio } from './section-tray-parts';

/**
 * Which of a group's channels it shows. Choosing goes back to the options, where
 * the row now reads the new choice — the dashboard's submenu, as a view.
 */
export function SectionFilterView(): ReactElement {
  const { goBack } = useTray();
  const group = useGroupPreference();

  return (
    <View className='px-3 pt-4 pb-2' style={{ flexShrink: 1 }}>
      <BackHeader title={`Filter ${group?.name ?? ''}`} onBack={goBack} />
      {CHANNEL_FILTER_OPTIONS.map(option => {
        const selected = group?.filterMode === option.value;
        return (
          <OptionRow
            key={option.value}
            label={option.label}
            {...(option.description !== undefined ? { description: option.description } : {})}
            highlighted={selected}
            trailing={<Radio selected={selected} />}
            onPress={() => {
              if (!selected) group?.setFilter(option.value);
              goBack();
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * How a group's channels are ordered. Manual order is a section's own
 * arrangement, so `Channels` does not offer it.
 */
export function SectionSortView(): ReactElement {
  const { goBack } = useTray();
  const group = useGroupPreference();
  const options = group?.isSection
    ? CHANNEL_SORT_OPTIONS
    : CHANNEL_SORT_OPTIONS.filter(option => option.value !== null);

  return (
    <View className='px-3 pt-4 pb-2' style={{ flexShrink: 1 }}>
      <BackHeader title={`Sort ${group?.name ?? ''}`} onBack={goBack} />
      {options.map(option => {
        const selected = group?.sortOrder === option.value;
        return (
          <OptionRow
            key={option.label}
            label={option.label}
            highlighted={selected}
            trailing={<Radio selected={selected} />}
            onPress={() => {
              if (!selected) group?.setSort(option.value);
              goBack();
            }}
          />
        );
      })}
    </View>
  );
}
