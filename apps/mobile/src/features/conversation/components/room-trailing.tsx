import { ArrowRight, Mic, Square, X } from 'lucide-react-native';
import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import {
  ChatInput,
  useChatInputConversation,
  useChatInputText,
} from '@/src/components/input-composer';
import { DictationWaveform } from '@/src/features/xyne-ai/components/DictationWaveform';

import {
  TYPING_BAR_DICTATING_WIDTH,
  TYPING_BAR_ICON_SIZE,
  TYPING_BAR_MIC_SIZE,
  TYPING_BAR_MORPH_MS,
  TYPING_BAR_MORPH_SCALE,
  TYPING_BAR_SEND_ICON_SIZE,
  TYPING_BAR_SEND_SIZE,
  TYPING_BAR_STOP_ICON_SIZE,
  TYPING_BAR_TRAILING_DROP,
} from '../constants';
import { useRoomDictationControls, useRoomDictationStatus } from '../hooks/use-room-dictation';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import { colorOf } from '../model/token-color';
import { typingBarAction } from '../model/typing-bar';
import { IconButton } from './icon-button';

const SEND_CONTAINER_STYLE = { marginBottom: 0 } as const;
const DICTATING_STYLE = {
  width: TYPING_BAR_DICTATING_WIDTH,
  height: TYPING_BAR_MIC_SIZE,
} as const;
const TRAILING_STYLE = { marginBottom: -TYPING_BAR_TRAILING_DROP } as const;
const WAVEFORM_STYLE = { width: TYPING_BAR_DICTATING_WIDTH - TYPING_BAR_MIC_SIZE * 2 } as const;

const { entering: morphIn, exiting: morphOut } = fadeScaleTransition({
  enterMs: TYPING_BAR_MORPH_MS,
  exitMs: TYPING_BAR_MORPH_MS,
  scale: TYPING_BAR_MORPH_SCALE,
});

type RoomTrailingProps = {
  disabled: boolean;
  /**
   * In the pill it hangs below the text's last line; in the focused card's
   * tool row it sits in the row, centred with the tools.
   */
  hang?: boolean;
};

/**
 * Mic, Send or the dictation controls at the field's right edge. Each swap
 * grows the incoming control in on the UI thread while the outgoing one
 * shrinks away; the first paint and the bar's unmount do not animate.
 */
function RoomTrailingComponent({ disabled, hang = true }: RoomTrailingProps): ReactElement {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { hasComposerContent } = useChatInputText();
  const status = useRoomDictationStatus();
  const { start, stop, cancel } = useRoomDictationControls();
  const [foregroundToken, mutedToken, accentToken, accentForegroundToken] = useCSSVariable([
    '--color-spaces-foreground',
    '--color-spaces-muted',
    '--color-spaces-accent',
    '--color-spaces-accent-foreground',
  ]);
  const foreground = colorOf(foregroundToken);
  const muted = colorOf(mutedToken);
  const accentForeground = colorOf(accentForegroundToken);
  const sendStyle = useMemo(
    () => (typeof accentToken === 'string' ? { backgroundColor: accentToken } : undefined),
    [accentToken],
  );

  const action = typingBarAction({
    hasContent: hasComposerContent,
    isEditing: isEditing || isTwinEditing,
    listening: status === 'listening',
  });

  let control: ReactElement;
  if (action === 'dictating') {
    control = (
      <View className='flex-row items-center' style={DICTATING_STYLE}>
        <IconButton label='Cancel dictation' size={TYPING_BAR_MIC_SIZE} onPress={cancel}>
          <X size={TYPING_BAR_ICON_SIZE} color={foreground} />
        </IconButton>
        <View style={WAVEFORM_STYLE}>
          <DictationWaveform height={TYPING_BAR_MIC_SIZE} />
        </View>
        <IconButton label='Stop dictation' size={TYPING_BAR_MIC_SIZE} onPress={stop}>
          <Square size={TYPING_BAR_STOP_ICON_SIZE} color={foreground} fill={foreground} />
        </IconButton>
      </View>
    );
  } else if (action === 'send') {
    control = (
      <ChatInput.Send
        size={TYPING_BAR_SEND_SIZE}
        containerStyle={SEND_CONTAINER_STYLE}
        style={sendStyle}
      >
        <ArrowRight size={TYPING_BAR_SEND_ICON_SIZE} color={accentForeground} />
      </ChatInput.Send>
    );
  } else {
    control = (
      <IconButton
        label='Dictate'
        size={TYPING_BAR_MIC_SIZE}
        disabled={disabled || status === 'stopping'}
        onPress={start}
      >
        <Mic size={TYPING_BAR_ICON_SIZE} color={muted} />
      </IconButton>
    );
  }

  // The last dictated words are still arriving; sending now would let them
  // write the sent text back into the cleared field.
  const blocksSend = action === 'send' && status === 'stopping';

  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <Animated.View
        key={action}
        entering={morphIn}
        exiting={morphOut}
        style={hang ? TRAILING_STYLE : undefined}
        pointerEvents={blocksSend ? 'none' : 'auto'}
      >
        {control}
      </Animated.View>
    </LayoutAnimationConfig>
  );
}

export const RoomTrailing = memo(RoomTrailingComponent);
RoomTrailing.displayName = 'RoomTrailing';
