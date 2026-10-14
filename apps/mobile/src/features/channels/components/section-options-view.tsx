import { useValue } from '@legendapp/state/react';
import { ListChecks, Pencil, Trash2 } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useTray } from '@/src/ui/tray';

import { channelSections$ } from '../state/rows-store';
import { sectionPicker$ } from '../state/section-picker-store';
import { OptionRow, TrayTitle } from './section-tray-parts';

const ICON_SIZE = 22;

export const SECTION_OPTIONS_VIEW = 'section-options';
export const RENAME_SECTION_VIEW = 'rename-section';
export const MANAGE_CHANNELS_VIEW = 'manage-channels';
export const DELETE_SECTION_VIEW = 'delete-section';

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

/**
 * What a long press on a section's header offers: the section's name, then
 * rename, manage channels and delete. Each pushes its own view into the card.
 */
export function SectionOptionsView(): ReactElement {
  const { setView } = useTray();
  const section = useManagedSection();

  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const accent = useCSSVariable('--color-spaces-accent') as string;

  return (
    <View className='px-3 pt-5 pb-2' style={{ flexShrink: 1 }}>
      <TrayTitle>{section?.name ?? ''}</TrayTitle>
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
      <OptionRow
        label='Delete section'
        emphasis
        leading={<Trash2 size={ICON_SIZE} color={accent} strokeWidth={1.8} />}
        onPress={() => setView(DELETE_SECTION_VIEW)}
      />
    </View>
  );
}
