import { useValue } from '@legendapp/state/react';
import {
  ChevronRight,
  ChevronsUpDown,
  Filter,
  ListChecks,
  Pencil,
  Trash2,
} from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  CHANNEL_FILTER_OPTIONS,
  CHANNEL_SORT_OPTIONS,
} from '@/src/components/chat/channel-list/channel-group-preferences';
import { useTray } from '@/src/ui/tray';

import { useGroupPreference } from '../hooks/use-group-preference';
import { channelSections$ } from '../state/rows-store';
import { sectionPicker$ } from '../state/section-picker-store';
import { OptionRow, TrayTitle } from './section-tray-parts';

const ICON_SIZE = 22;

export const SECTION_OPTIONS_VIEW = 'section-options';
export const RENAME_SECTION_VIEW = 'rename-section';
export const MANAGE_CHANNELS_VIEW = 'manage-channels';
export const DELETE_SECTION_VIEW = 'delete-section';
export const SECTION_FILTER_VIEW = 'section-filter';
export const SECTION_SORT_VIEW = 'section-sort';

/** The section being managed, or nothing while the tray is not about one. */
export function useManagedSection(): { id: string; name: string } | null {
  const sectionId = useValue(sectionPicker$.sectionId);
  const name = useValue(() =>
    sectionId === null
      ? null
      : (channelSections$.get().find(section => section.id === sectionId)?.name ?? null),
  );
  return sectionId !== null && name !== null ? { id: sectionId, name } : null;
}

/** The current choice, then a chevron: this row opens a list of its own. */
function CurrentChoice({ label }: { label: string }): ReactElement {
  const muted = useCSSVariable('--color-spaces-muted') as string;

  return (
    <View className='flex-row items-center gap-1'>
      <Text numberOfLines={1} className='text-[15px] text-spaces-muted'>
        {label}
      </Text>
      <ChevronRight size={18} color={muted} strokeWidth={2} />
    </View>
  );
}

/**
 * What a group header's more button offers, in the dashboard's order.
 *
 * A section: rename and manage channels, then its settings — filter and sort —
 * then delete. `Channels` is not a section, so it has only the settings. Each
 * row pushes its own view into the card.
 */
export function SectionOptionsView(): ReactElement {
  const { setView } = useTray();
  const group = useGroupPreference();

  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const accent = useCSSVariable('--color-spaces-accent') as string;

  const isSection = group?.isSection === true;
  const filterLabel =
    CHANNEL_FILTER_OPTIONS.find(option => option.value === group?.filterMode)?.label ?? '';
  const sortLabel =
    CHANNEL_SORT_OPTIONS.find(option => option.value === group?.sortOrder)?.label ?? '';

  return (
    <View className='px-3 pt-5 pb-2' style={{ flexShrink: 1 }}>
      <TrayTitle>{group?.name ?? ''}</TrayTitle>

      {isSection ? (
        <>
          <OptionRow
            label='Rename section'
            leading={<Pencil size={ICON_SIZE} color={foreground} strokeWidth={1.8} />}
            onPress={() => setView(RENAME_SECTION_VIEW)}
          />
          <OptionRow
            label='Manage channels'
            leading={<ListChecks size={ICON_SIZE} color={foreground} strokeWidth={1.8} />}
            onPress={() => setView(MANAGE_CHANNELS_VIEW)}
          />
          <View className='mx-3 my-2 h-px bg-spaces-surface' />
        </>
      ) : null}

      <TrayTitle>Section settings</TrayTitle>
      <OptionRow
        label='Filter'
        leading={<Filter size={ICON_SIZE} color={foreground} strokeWidth={1.8} />}
        trailing={<CurrentChoice label={filterLabel} />}
        onPress={() => setView(SECTION_FILTER_VIEW)}
      />
      <OptionRow
        label='Sort'
        leading={<ChevronsUpDown size={ICON_SIZE} color={foreground} strokeWidth={1.8} />}
        trailing={<CurrentChoice label={sortLabel} />}
        onPress={() => setView(SECTION_SORT_VIEW)}
      />

      {isSection ? (
        <>
          <View className='mx-3 my-2 h-px bg-spaces-surface' />
          <OptionRow
            label='Delete section'
            emphasis
            leading={<Trash2 size={ICON_SIZE} color={accent} strokeWidth={1.8} />}
            onPress={() => setView(DELETE_SECTION_VIEW)}
          />
        </>
      ) : null}
    </View>
  );
}
