import { useMemo, type ReactElement, type RefObject } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JoinChannelCard } from '@/src/components/chat/join-channel-card';
import { ConversationInput, type ChatInputSendHandler } from '@/src/components/input-composer';
import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';

import { getChatKeyboardGeometry } from './chatKeyboardConfig';

export type ChatComposerDockProps = {
  conversationId: string;
  threadId?: string;
  onSend: ChatInputSendHandler;
  disabled?: boolean;
  editingMessage?: ChatInputEditingMessage | null;
  onCancelEdit?: () => void;
  composerRef?: RefObject<View | null>;
  onComposerLayout?: (event: LayoutChangeEvent) => void;
  joinChannel?: { channelId: string; channelTitle?: string };
};

const DOCK = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 30,
  backgroundColor: 'transparent',
} as const;

/**
 * Composer dock + geometry (design §3.1). Hosts `components/input-composer`
 * (R4), or the join-channel card when the viewer is not a member. Pass as
 * `ConversationList` children so B8 measures this node.
 */
export function ChatComposerDock({
  conversationId,
  threadId,
  onSend,
  disabled = false,
  editingMessage = null,
  onCancelEdit,
  composerRef,
  onComposerLayout,
  joinChannel,
}: ChatComposerDockProps): ReactElement {
  const insets = useSafeAreaInsets();
  const geometry = useMemo(() => getChatKeyboardGeometry(insets.bottom), [insets.bottom]);
  const isKeyboardVisible = useKeyboardState(state => state.isVisible);
  const blockInput = disabled && joinChannel === undefined;

  return (
    <KeyboardStickyView
      enabled={isKeyboardVisible}
      offset={geometry.stickyOffset}
      pointerEvents={blockInput ? 'none' : 'box-none'}
      style={DOCK}
    >
      <View ref={composerRef} collapsable={false} onLayout={onComposerLayout}>
        {joinChannel ? (
          <JoinChannelCard
            channelId={joinChannel.channelId}
            channelTitle={joinChannel.channelTitle}
          />
        ) : (
          <ConversationInput
            key={conversationId}
            conversationId={conversationId}
            {...(threadId ? { threadId } : {})}
            onSend={onSend}
            disabled={disabled}
            editingMessage={editingMessage}
            {...(threadId ? { placeholder: 'Reply to thread' } : {})}
            {...(onCancelEdit ? { onCancelEdit } : {})}
          />
        )}
      </View>
    </KeyboardStickyView>
  );
}
