import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { ChatComposerScrollToBottomButtonProps } from '@/src/features/chat/v2/components/chat/chat-composer-dock';

import {
  JUMP_ARROW_ENTER_MS,
  JUMP_ARROW_ENTER_SCALE,
  JUMP_ARROW_EXIT_MS,
  JUMP_ARROW_GAP,
  JUMP_ARROW_ICON_SIZE,
  JUMP_ARROW_INSET_RIGHT,
  JUMP_ARROW_SIZE,
  ROW_SHADOW,
} from '../constants';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import { colorOf } from '../model/token-color';
import { IconButton } from './icon-button';

const { entering, exiting } = fadeScaleTransition({
  enterMs: JUMP_ARROW_ENTER_MS,
  exitMs: JUMP_ARROW_EXIT_MS,
  scale: JUMP_ARROW_ENTER_SCALE,
  enterEasing: Easing.out(Easing.cubic),
  exitEasing: Easing.in(Easing.cubic),
});

/**
 * Figma "Room / Jump arrow": shown while the room is scrolled up from the
 * newest message, riding 8 above the typing bar whatever it holds. It stands
 * in for the classic scroll-to-bottom button, so visibility stays the
 * controller's.
 */
export function ConversationJumpArrow({
  composerHeight,
  enabled,
  onPress,
  visible,
}: ChatComposerScrollToBottomButtonProps): ReactElement | null {
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const offsetStyle = useAnimatedStyle(
    () => ({ bottom: composerHeight.get() + JUMP_ARROW_GAP }),
    [composerHeight],
  );

  if (!enabled || !visible) return null;

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      pointerEvents='box-none'
      style={[styles.anchor, offsetStyle]}
    >
      <IconButton
        label='Scroll to bottom'
        size={JUMP_ARROW_SIZE}
        onPress={onPress}
        className='bg-spaces-surface-raised'
      >
        <ChevronDown size={JUMP_ARROW_ICON_SIZE} color={foreground} />
      </IconButton>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    right: JUMP_ARROW_INSET_RIGHT,
    width: JUMP_ARROW_SIZE,
    height: JUMP_ARROW_SIZE,
    borderRadius: JUMP_ARROW_SIZE / 2,
    boxShadow: ROW_SHADOW,
  },
});
