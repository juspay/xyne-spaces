import { memo, useEffect, type ReactElement, type ReactNode } from 'react';
import { Pressable, View, type ViewStyle, type StyleProp } from 'react-native';
import { SendHorizontal } from 'lucide-react-native';

import {
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputText,
} from './input-composer-context';
import type { ChatInputSendHandler } from './input-composer.types';
import { COMPOSER_SEND_BUTTON_SIZE, composerSendOpacity } from './composer-input-typography';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

type SendProps = {
  className?: string;
  style?: StyleProp<ViewStyle>;
  onSend?: ChatInputSendHandler;
  children?: ReactNode;
  /** Optional edge length; unset keeps the composer's send button size. */
  size?: number;
  /** Optional style for the wrapper around the button (e.g. to drop its bottom margin). */
  containerStyle?: StyleProp<ViewStyle>;
};

const SendComponent = ({
  className,
  style,
  onSend,
  children,
  size = COMPOSER_SEND_BUTTON_SIZE,
  containerStyle,
}: SendProps): ReactElement | null => {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { accentBg, accentFg } = useBubbleAccent();
  const { canSend } = useChatInputText();
  const { send, openSchedule, registerSendOverride } = useChatInputHandlers();

  useEffect(() => {
    if (isEditing || isTwinEditing) {
      registerSendOverride(null);
      return (): void => registerSendOverride(null);
    }
    registerSendOverride(onSend ?? null);
    return (): void => registerSendOverride(null);
  }, [isEditing, isTwinEditing, onSend, registerSendOverride]);

  const handlePress = (): void => {
    if (!canSend) return;
    void haptics.buttonTap();
    void send();
  };

  const handleLongPress = (): void => {
    if (isEditing || isTwinEditing || !canSend) return;
    void haptics.longPress();
    openSchedule();
  };

  return (
    <View
      collapsable={false}
      style={[
        {
          width: size,
          height: size,
          marginBottom: 4,
          flexShrink: 0,
        },
        containerStyle,
      ]}
    >
      <Pressable
        className={cn('items-center justify-center rounded-full', className)}
        style={[
          {
            width: size,
            height: size,
            backgroundColor: accentBg,
          },
          style,
          { opacity: composerSendOpacity(canSend) },
        ]}
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={350}
        disabled={!canSend}
        accessibilityRole='button'
        accessibilityLabel={
          isTwinEditing ? 'Send twin draft' : isEditing ? 'Save edited message' : 'Send message'
        }
        accessibilityState={{ disabled: !canSend }}
      >
        {children ?? <SendHorizontal size={20} color={accentFg} />}
      </Pressable>
    </View>
  );
};
const Send = memo(SendComponent);
Send.displayName = 'ChatInput.Submit';

export { Send };
