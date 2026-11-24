import { Check } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  useChatInputActions,
  useChatInputConversation,
  useChatInputComposerState,
  useChatInputText,
} from './input-composer-context';
import { cn } from '@/src/utils/cn';
import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';

type AlsoSendToChannelProps = {
  className?: string;
  label?: string;
};

type AlsoSendToChannelState = {
  /** A thread reply with something to send, outside an edit. */
  visible: boolean;
  checked: boolean;
  toggle: () => void;
};

/** When the "Also send to channel" choice shows, and its value, for any surface that draws it. */
export const useAlsoSendToChannel = (): AlsoSendToChannelState => {
  const { threadId, isEditing, isTwinEditing } = useChatInputConversation();
  const { alsoSendToChannel } = useChatInputComposerState();
  const { hasComposerContent } = useChatInputText();
  const { setAlsoSendToChannelState } = useChatInputActions();
  const toggle = useCallback(
    (): void => setAlsoSendToChannelState(!alsoSendToChannel),
    [alsoSendToChannel, setAlsoSendToChannelState],
  );
  return {
    visible: !isEditing && !isTwinEditing && Boolean(threadId) && hasComposerContent,
    checked: alsoSendToChannel,
    toggle,
  };
};

const AlsoSendToChannelComponent = ({
  className,
  label = 'Also send to channel',
}: AlsoSendToChannelProps): ReactElement | null => {
  const {
    visible: canShowAlsoSendToChannel,
    checked: alsoSendToChannel,
    toggle,
  } = useAlsoSendToChannel();
  const {
    tokens: { ambientActionBg },
  } = useSelectedChatBubbleContentTokens();
  const borderColor = useCSSVariable('--color-border') as string;
  const conversationInputAlsoSendToChannelTextColor = useCSSVariable(
    '--color-conversation-input-also-send-to-channel-text',
  ) as string;

  if (!canShowAlsoSendToChannel) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityLabel={label}
      accessibilityState={{ checked: alsoSendToChannel }}
      onPress={toggle}
      className={cn('flex-row items-center gap-2 px-1 py-1', className)}
    >
      <View
        className='h-4 w-4 rounded border items-center justify-center'
        style={{
          borderColor,
          backgroundColor: alsoSendToChannel ? ambientActionBg : 'transparent',
        }}
      >
        {alsoSendToChannel ? <Check size={12} color='#fff' /> : null}
      </View>
      <Text className='text-sm' style={{ color: conversationInputAlsoSendToChannelTextColor }}>
        {label}
      </Text>
    </Pressable>
  );
};
const AlsoSendToChannel = memo(AlsoSendToChannelComponent);

AlsoSendToChannel.displayName = 'ChatInput.AlsoSendToChannel';

export { AlsoSendToChannel };
