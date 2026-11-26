import { X } from 'lucide-react-native';
import { useCallback, useRef, type ReactElement } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useChatInputActions } from '@/src/components/input-composer';
import { FORMAT_BUTTONS } from '@/src/components/input-composer/input-composer-format-button';

import {
  TYPING_BAR_FORMAT_DIVIDER_HEIGHT,
  TYPING_BAR_FORMAT_FADE_WIDTH,
  TYPING_BAR_ICON_SIZE,
  TYPING_BAR_TOOL_GAP,
  TYPING_BAR_TOOL_HIT_SLOP,
  TYPING_BAR_TOOL_SIZE,
  TYPING_BAR_TOOLS_SWAP_MS,
} from '../constants';
import { useMountAccessibilityFocus } from '../hooks/use-mount-accessibility-focus';
import { colorOf } from '../model/token-color';
import { IconButton } from './icon-button';
import { RoomFormatButton } from './room-format-button';
import { RoomFormatFade } from './room-format-fade';

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    gap: TYPING_BAR_TOOL_GAP,
    paddingRight: TYPING_BAR_FORMAT_FADE_WIDTH,
  },
  row: { gap: TYPING_BAR_TOOL_GAP },
  divider: { width: StyleSheet.hairlineWidth, height: TYPING_BAR_FORMAT_DIVIDER_HEIGHT },
});

/**
 * The formatting strip, in place of the tools: a close back to the tools
 * where Aa sat, so the same spot opens and shuts it, a hairline, then every
 * style the editor has, scrolling within the room left of mic / Send and
 * fading out at its right edge. It opens from Aa, so a screen reader moves
 * to its close, where Aa was.
 */
export function RoomFormatStrip({ disabled }: { disabled: boolean }): ReactElement {
  const { setIsFormattingVisibleState } = useChatInputActions();
  const [activeToken, mutedToken] = useCSSVariable([
    '--color-spaces-accent',
    '--color-spaces-muted',
  ]);
  const active = colorOf(activeToken);
  const muted = colorOf(mutedToken);
  const closeRef = useRef<View>(null);
  useMountAccessibilityFocus(closeRef, true, TYPING_BAR_TOOLS_SWAP_MS);

  const hide = useCallback(
    (): void => setIsFormattingVisibleState(false),
    [setIsFormattingVisibleState],
  );

  return (
    <View className='min-w-0 flex-1 flex-row items-center' style={styles.row}>
      <IconButton
        ref={closeRef}
        label='Hide formatting'
        size={TYPING_BAR_TOOL_SIZE}
        hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
        disabled={disabled}
        onPress={hide}
      >
        <X size={TYPING_BAR_ICON_SIZE} color={muted} />
      </IconButton>
      <View className='bg-spaces-outline' style={styles.divider} />
      <View className='min-w-0 flex-1'>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // The field keeps its keyboard while styles are tapped.
          keyboardShouldPersistTaps='always'
          contentContainerStyle={styles.content}
        >
          {FORMAT_BUTTONS.map(config => (
            <RoomFormatButton
              key={config.id}
              config={config}
              activeColor={active}
              inactiveColor={muted}
              disabled={disabled}
            />
          ))}
        </ScrollView>
        <RoomFormatFade />
      </View>
    </View>
  );
}
