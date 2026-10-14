import { useValue } from '@legendapp/state/react';
import { Plus, X } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { LayersIcon } from '@/src/features/bottom-navigation/icons';
import { useTray } from '@/src/ui/tray';

import { useChannelActions } from '../hooks/use-channel-actions';
import { channelRow$, channelSections$ } from '../state/rows-store';
import { sectionPicker$ } from '../state/section-picker-store';
import { OptionRow, Radio, TrayTitle } from './section-tray-parts';

const ICON_SIZE = 22;

export const SECTIONS_VIEW = 'sections';

/**
 * "Move #channel to": the sections as a single choice, plus the two ways out
 * of that list — no section at all, or a new one.
 *
 * Choosing closes the tray, because the choice is the whole task. New section
 * is the exception: it pushes a second view into the same card.
 */
export function SectionPickerView(): ReactElement {
  const { close, setView } = useTray();
  const { moveToSection } = useChannelActions();

  const muted = useCSSVariable('--color-spaces-muted') as string;
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const accent = useCSSVariable('--color-spaces-accent') as string;

  const channelId = useValue(sectionPicker$.channelId);
  const name = useValue(() => (channelId ? channelRow$(channelId).name.get() : ''));
  const currentSectionId = useValue(() =>
    channelId ? (channelRow$(channelId).sectionId.get() ?? null) : null,
  );
  const sections = useValue(channelSections$);

  const choose = (sectionId: string | null): void => {
    if (channelId !== null && sectionId !== currentSectionId) {
      moveToSection(channelId, sectionId);
    }
    close();
  };

  return (
    <View className='px-3 pt-5 pb-2' style={{ flexShrink: 1 }}>
      <TrayTitle>{`Move #${name ?? ''} to`}</TrayTitle>

      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
        {sections.map(section => (
          <OptionRow
            key={section.id}
            label={section.name}
            highlighted={section.id === currentSectionId}
            leading={<LayersIcon width={ICON_SIZE} height={ICON_SIZE} color={muted} />}
            trailing={<Radio selected={section.id === currentSectionId} />}
            onPress={() => choose(section.id)}
          />
        ))}
        <OptionRow
          label='No section'
          highlighted={currentSectionId === null}
          leading={<X size={ICON_SIZE} color={foreground} strokeWidth={1.8} />}
          trailing={<Radio selected={currentSectionId === null} />}
          onPress={() => choose(null)}
        />
      </ScrollView>

      <OptionRow
        label='New section'
        emphasis
        leading={<Plus size={ICON_SIZE} color={accent} strokeWidth={2} />}
        onPress={() => setView('new-section')}
      />
    </View>
  );
}
