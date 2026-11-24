import { X } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { LayersIcon } from '@/src/features/bottom-navigation/icons';
import { Radio } from '@/src/features/channels/components/section-tray-parts';
import { Tray } from '@/src/ui/tray';
import { OptionRow, TrayTitle } from '@/src/ui/tray/parts';

import { CHANNEL_INFO_ROW_ICON_SIZE } from '../constants';
import { colorOf } from '../model/token-color';

const SECTIONS_VIEW = 'sections';

type ChannelSectionTrayProps = {
  open: boolean;
  channelName: string;
  sections: readonly { id: string; name: string }[];
  currentSectionId: string | null;
  onChoose: (sectionId: string | null) => void;
  onClose: () => void;
};

/**
 * "Move #channel to", the channel list's section picker in the same tray
 * parts: the sections as a single choice, plus no section. The list's own
 * tray is driven by that screen's store and stays mounted under this one, so
 * opening it from here would raise it too; this one is local to the screen.
 */
export function ChannelSectionTray({
  open,
  channelName,
  sections,
  currentSectionId,
  onChoose,
  onClose,
}: ChannelSectionTrayProps): ReactElement {
  const [mutedToken, foregroundToken] = useCSSVariable([
    '--color-spaces-muted',
    '--color-spaces-foreground',
  ]);
  const muted = colorOf(mutedToken);
  const foreground = colorOf(foregroundToken);

  const choose = (sectionId: string | null): void => {
    if (sectionId !== currentSectionId) onChoose(sectionId);
    onClose();
  };

  return (
    <Tray.Root
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      defaultView={SECTIONS_VIEW}
    >
      <Tray.Content>
        <Tray.Body>
          <Tray.View name={SECTIONS_VIEW} style={styles.shrink}>
            <View className='px-3 pt-5 pb-2' style={styles.shrink}>
              <TrayTitle>{`Move #${channelName} to`}</TrayTitle>
              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
                style={styles.shrink}
              >
                {sections.map(section => (
                  <OptionRow
                    key={section.id}
                    label={section.name}
                    highlighted={section.id === currentSectionId}
                    leading={
                      <LayersIcon
                        width={CHANNEL_INFO_ROW_ICON_SIZE}
                        height={CHANNEL_INFO_ROW_ICON_SIZE}
                        color={muted}
                      />
                    }
                    trailing={<Radio selected={section.id === currentSectionId} />}
                    onPress={() => choose(section.id)}
                  />
                ))}
                <OptionRow
                  label='No section'
                  highlighted={currentSectionId === null}
                  leading={<X size={CHANNEL_INFO_ROW_ICON_SIZE} color={foreground} />}
                  trailing={<Radio selected={currentSectionId === null} />}
                  onPress={() => choose(null)}
                />
              </ScrollView>
            </View>
          </Tray.View>
        </Tray.Body>
      </Tray.Content>
    </Tray.Root>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
});
