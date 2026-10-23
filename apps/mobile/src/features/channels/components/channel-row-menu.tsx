import { useValue } from '@legendapp/state/react';
import { type ReactElement } from 'react';
import { useCSSVariable } from 'uniwind';

import { LayersIcon } from '@/src/features/bottom-navigation/icons';
import { StarIcon, STAR_COLOR } from '@/src/features/dms/icons';
import { ContextMenu } from '@/src/ui/context-menu';
import { MENU_ICON_SIZE } from '@/src/ui/context-menu/constants';

import { useChannelActions } from '../hooks/use-channel-actions';
import { channelRow$, channelSections$ } from '../state/rows-store';
import { openSectionPicker } from '../state/section-picker-store';

const NO_SECTION_LABEL = 'None';

/**
 * What a long press on a channel offers.
 *
 * Mounted by the row but rendering nothing until the menu is open. Reads the
 * row live so the label says Unstar once Star has been tapped, and the section
 * value follows a move made from the tray.
 */
export function ChannelRowMenu({ id }: { id: string }): ReactElement {
  const { toggleStar } = useChannelActions();
  const muted = useCSSVariable('--color-spaces-muted') as string;

  const name = useValue(() => channelRow$(id).name.get());
  const isStarred = useValue(() => channelRow$(id).isStarred.get()) === true;
  const sectionName = useValue(() => {
    const sectionId = channelRow$(id).sectionId.get();
    if (!sectionId) return null;
    return channelSections$.get().find(section => section.id === sectionId)?.name ?? null;
  });

  return (
    <ContextMenu.Content label={`#${name ?? ''}`}>
      <ContextMenu.Item
        label={isStarred ? 'Unstar' : 'Star'}
        icon={<StarIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={STAR_COLOR} />}
        onSelect={() => toggleStar(id)}
      />
      <ContextMenu.Item
        label='Section'
        value={sectionName ?? NO_SECTION_LABEL}
        chevron
        icon={<LayersIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={muted} />}
        onSelect={() => openSectionPicker(id)}
      />
    </ContextMenu.Content>
  );
}
