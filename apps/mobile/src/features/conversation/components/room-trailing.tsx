import { ArrowRight, Mic, Square, X } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  ChatInput,
  useChatInputConversation,
  useChatInputText,
} from '@/src/components/input-composer';
import { DictationWaveform } from '@/src/features/xyne-ai/components/DictationWaveform';

import type { RoomDictation } from '../hooks/use-room-dictation';
import { DICTATING_WIDTH, MIC_SIZE, SEND_SIZE, typingBarAction } from '../model/typing-bar';

const SEND_CONTAINER_STYLE = { marginBottom: 0 } as const;

type RoomTrailingProps = {
  dictation: RoomDictation;
  disabled: boolean;
};

const RoundButton = ({
  label,
  size,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  size: number;
  onPress: () => void;
  disabled?: boolean;
  children: ReactElement;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    disabled={disabled}
    onPress={onPress}
    className={`items-center justify-center rounded-full active:opacity-60 ${disabled ? 'opacity-40' : ''}`}
    style={{ width: size, height: size }}
  >
    {children}
  </Pressable>
);

function RoomTrailingComponent({ dictation, disabled }: RoomTrailingProps): ReactElement {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { hasComposerContent } = useChatInputText();
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const accent = useCSSVariable('--color-spaces-accent') as string;
  const accentForeground = useCSSVariable('--color-spaces-accent-foreground') as string;

  const action = typingBarAction({
    hasContent: hasComposerContent,
    isEditing: isEditing || isTwinEditing,
    listening: dictation.listening,
  });

  if (action === 'dictating') {
    return (
      <View className='flex-row items-center' style={{ width: DICTATING_WIDTH, height: MIC_SIZE }}>
        <RoundButton label='Cancel dictation' size={MIC_SIZE} onPress={dictation.cancel}>
          <X size={20} color={foreground} />
        </RoundButton>
        <View style={{ width: DICTATING_WIDTH - MIC_SIZE * 2 }}>
          <DictationWaveform height={MIC_SIZE} />
        </View>
        <RoundButton label='Stop dictation' size={MIC_SIZE} onPress={dictation.stop}>
          <Square size={14} color={foreground} fill={foreground} />
        </RoundButton>
      </View>
    );
  }

  if (action === 'send') {
    // The last dictated words are still arriving; sending now would let them
    // write the sent text back into the cleared field.
    return (
      <View pointerEvents={dictation.status === 'stopping' ? 'none' : 'auto'}>
        <ChatInput.Send
          size={SEND_SIZE}
          containerStyle={SEND_CONTAINER_STYLE}
          style={{ backgroundColor: accent }}
        >
          <ArrowRight size={20} color={accentForeground} />
        </ChatInput.Send>
      </View>
    );
  }

  return (
    <RoundButton
      label='Dictate'
      size={MIC_SIZE}
      disabled={disabled || dictation.status === 'stopping'}
      onPress={dictation.start}
    >
      <Mic size={20} color={foreground} />
    </RoundButton>
  );
}

export const RoomTrailing = memo(RoomTrailingComponent);
RoomTrailing.displayName = 'RoomTrailing';
