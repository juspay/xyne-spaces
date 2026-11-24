import { Pencil } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { useChatInputConversation, useChatInputHandlers } from '@/src/components/input-composer';
import { haptics } from '@/src/utils/haptics';

import {
  TYPING_BAR_STRIP_ENTER_MS,
  TYPING_BAR_STRIP_EXIT_MS,
  TYPING_BAR_STRIP_GAP,
  TYPING_BAR_STRIP_HEIGHT,
  TYPING_BAR_STRIP_HIT_SLOP,
  TYPING_BAR_STRIP_ICON_SIZE,
  TYPING_BAR_STRIP_SCALE,
} from '../constants';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import { colorOf } from '../model/token-color';

const STRIP_STYLE = { height: TYPING_BAR_STRIP_HEIGHT, gap: TYPING_BAR_STRIP_GAP } as const;
/** Cancel fills the strip's height, so the slop takes its touch area to 44. */
const CANCEL_STYLE = { height: TYPING_BAR_STRIP_HEIGHT } as const;
const CANCEL_HIT_SLOP = {
  top: TYPING_BAR_STRIP_HIT_SLOP,
  bottom: TYPING_BAR_STRIP_HIT_SLOP,
  left: TYPING_BAR_STRIP_GAP,
  right: TYPING_BAR_STRIP_GAP,
} as const;

const { entering, exiting } = fadeScaleTransition({
  enterMs: TYPING_BAR_STRIP_ENTER_MS,
  exitMs: TYPING_BAR_STRIP_EXIT_MS,
  scale: TYPING_BAR_STRIP_SCALE,
});

/**
 * "Editing message" over the field while a message is being edited, with a
 * Cancel that leaves the edit the way the classic banner's cross does, so
 * the draft from before the edit comes back.
 */
function RoomEditStripComponent(): ReactElement | null {
  const { isEditing } = useChatInputConversation();
  const { onCancelEdit } = useChatInputHandlers();
  const muted = colorOf(useCSSVariable('--color-spaces-muted'));

  if (!isEditing) return null;

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      className='w-full flex-row items-center'
      style={STRIP_STYLE}
    >
      <Pencil size={TYPING_BAR_STRIP_ICON_SIZE} color={muted} />
      <Text
        className='min-w-0 flex-1 text-[14px] font-medium leading-[18px] text-spaces-muted'
        numberOfLines={1}
      >
        Editing message
      </Text>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Cancel editing'
        hitSlop={CANCEL_HIT_SLOP}
        onPressIn={() => void haptics.buttonTap()}
        onPress={() => onCancelEdit?.()}
        className='justify-center active:opacity-60'
        style={CANCEL_STYLE}
      >
        <Text className='text-[16px] leading-[22px] tracking-[-0.176px] text-spaces-read-more'>
          Cancel
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export const RoomEditStrip = memo(RoomEditStripComponent);
RoomEditStrip.displayName = 'RoomEditStrip';
