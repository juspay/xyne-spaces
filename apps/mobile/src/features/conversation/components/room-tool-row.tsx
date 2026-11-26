import { memo, useEffect, useRef, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { useChatInputPanelState } from '@/src/components/input-composer';

import {
  TYPING_BAR_TOOL_GLYPH_INSET,
  TYPING_BAR_TOOLS_SWAP_MS,
  TYPING_BAR_TOOLS_SWAP_SCALE,
  TYPING_BAR_TRAILING_GUTTER,
} from '../constants';
import { useRoomDictationStatus } from '../hooks/use-room-dictation';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import { toolRowLeading } from '../model/tool-row';
import { RoomFormatStrip } from './room-format-strip';
import { RoomTools } from './room-tools';
import { RoomTrailing } from './room-trailing';

const { entering: swapIn, exiting: swapOut } = fadeScaleTransition({
  enterMs: TYPING_BAR_TOOLS_SWAP_MS,
  exitMs: TYPING_BAR_TOOLS_SWAP_MS,
  scale: TYPING_BAR_TOOLS_SWAP_SCALE,
});
// Only a fade as the card opens: the row must not grow while the card does.
const { entering: rowIn } = fadeScaleTransition({
  enterMs: TYPING_BAR_TOOLS_SWAP_MS,
  exitMs: TYPING_BAR_TOOLS_SWAP_MS,
  scale: 1,
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: TYPING_BAR_TRAILING_GUTTER },
  leading: { flex: 1, minWidth: 0, marginLeft: -TYPING_BAR_TOOL_GLYPH_INSET },
  swap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
});

/**
 * The focused card's bottom row: the tools or the formatting strip on the
 * left, mic / Send on the right. Aa and the strip's close cross-fade the two;
 * the row fades in as the field takes focus. Dictation takes the row at once:
 * the tools leave without fading, so they never sit under its controls.
 */
function RoomToolRowComponent({ disabled }: { disabled: boolean }): ReactElement {
  const { isFormattingVisible } = useChatInputPanelState();
  const status = useRoomDictationStatus();
  const leading = toolRowLeading({
    formatting: isFormattingVisible,
    dictating: status === 'listening',
  });
  const previousLeading = useRef(leading);
  const backFromFormatting = previousLeading.current === 'formatting' && leading === 'tools';
  useEffect(() => {
    previousLeading.current = leading;
  }, [leading]);

  return (
    <Animated.View entering={rowIn} style={styles.row}>
      <View style={styles.leading}>
        {/* Keyed on whether anything shows, so going to dictation unmounts this config and skips the swap's exit. */}
        <LayoutAnimationConfig key={leading === 'none' ? 'none' : 'some'} skipEntering skipExiting>
          {leading === 'none' ? null : (
            <Animated.View key={leading} entering={swapIn} exiting={swapOut} style={styles.swap}>
              {leading === 'formatting' ? (
                <RoomFormatStrip disabled={disabled} />
              ) : (
                <RoomTools disabled={disabled} focusFormatting={backFromFormatting} />
              )}
            </Animated.View>
          )}
        </LayoutAnimationConfig>
      </View>
      <RoomTrailing disabled={disabled} hang={false} />
    </Animated.View>
  );
}

export const RoomToolRow = memo(RoomToolRowComponent);
RoomToolRow.displayName = 'RoomToolRow';
