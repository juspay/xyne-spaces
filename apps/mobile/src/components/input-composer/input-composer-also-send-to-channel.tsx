import { Check } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
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

const AlsoSendToChannelComponent = ({
  className,
  label = 'Also send to channel',
}: AlsoSendToChannelProps): ReactElement | null => {
  const { threadId, isEditing, isTwinEditing } = useChatInputConversation();
  const { alsoSendToChannel } = useChatInputComposerState();
  const { hasComposerContent } = useChatInputText();
  const canShowAlsoSendToChannel =
    !isEditing && !isTwinEditing && Boolean(threadId) && hasComposerContent;
  const { setAlsoSendToChannelState } = useChatInputActions();
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
      onPress={() => setAlsoSendToChannelState(!alsoSendToChannel)}
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
