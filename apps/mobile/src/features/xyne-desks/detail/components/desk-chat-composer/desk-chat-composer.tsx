import { memo, useCallback, type ReactElement } from 'react';
import { Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JoinChannelCard } from '@/src/components/chat/join-channel-card';
import {
  ConversationInput,
  getConversationInputMinimumHeight,
  type ChatInputSendPayload,
} from '@/src/components/input-composer';
import { useAuth } from '@/src/contexts/AuthContext';
import { ChatComposerDock } from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { getChatKeyboardGeometry } from '@/src/features/chat/v3/composer/chatKeyboardConfig';
import { useChatComposerGeometry } from '@/src/features/chat/v2/hooks/use-chat-composer-geometry';
import { clearTicketDetailPaintCache } from '@/src/features/xyne-desks/detail/utils';
import { clearTicketsPaintCache } from '@/src/features/xyne-desks/tickets/utils';
import { showMessageToast } from '@/src/utils/toast';

import { getChatDeskReplyErrorMessage, sendChatDeskReply } from './send-chat-desk-reply';

type DeskChatComposerProps = {
  channelId: string;
  channelType: string;
  conversationId: string | null;
  isMember: boolean;
  xyneId: string;
  ticketId: string;
  onHeightChange?: ((height: number) => void) | undefined;
};

export const DeskChatComposer = memo(function DeskChatComposer({
  channelId,
  channelType,
  conversationId,
  isMember,
  xyneId,
  ticketId,
  onHeightChange,
}: DeskChatComposerProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { workspaceSessionKey } = useAuth();
  const includeBottomSafeArea = true;
  const minimumHeight = getConversationInputMinimumHeight(insets.bottom, includeBottomSafeArea);
  const shellReadyKey = `${channelId}:${conversationId ?? 'none'}`;
  const keyboardGeometry = getChatKeyboardGeometry(insets.bottom);
  const composerGeometry = useChatComposerGeometry(minimumHeight, shellReadyKey);

  const handleComposerHeight = useCallback(
    (height: number): void => {
      composerGeometry.onComposerHeight(height);
      if (Number.isFinite(height) && height > 0) {
        onHeightChange?.(Math.max(minimumHeight, Math.ceil(height)));
      }
    },
    [composerGeometry, minimumHeight, onHeightChange],
  );

  const handleSend = useCallback(
    async (
      { text, html, attachments }: ChatInputSendPayload,
      restore: () => void,
    ): Promise<void> => {
      if (!isMember) {
        Alert.alert('Join desk', 'Join this desk before sending replies.');
        restore();
        return;
      }
      if (!conversationId) {
        Alert.alert('Error', 'Unable to send reply. Missing ticket conversation.');
        restore();
        return;
      }

      const attachmentIds = attachments
        .filter(attachment => attachment.status === 'uploaded')
        .map(attachment => attachment.attachmentId);

      try {
        const response = await sendChatDeskReply({
          channelType,
          conversationId,
          bodyText: text,
          bodyHtml: html,
          attachmentIds,
        });

        clearTicketDetailPaintCache(workspaceSessionKey, channelId, xyneId);
        clearTicketDetailPaintCache(workspaceSessionKey, channelId, ticketId);
        clearTicketsPaintCache(workspaceSessionKey, channelId);

        if (response.delivered === false) {
          showMessageToast('Saved to the ticket, but not sent to the app.');
          return;
        }
        showMessageToast('Reply sent');
      } catch (error) {
        showMessageToast(getChatDeskReplyErrorMessage(error));
        throw error;
      }
    },
    [channelId, channelType, conversationId, isMember, ticketId, workspaceSessionKey, xyneId],
  );

  return (
    <ChatComposerDock
      composerHeight={composerGeometry.totalHeight}
      keyboardGeometry={keyboardGeometry}
      onComposerHeight={handleComposerHeight}
      onComposerLayout={composerGeometry.onComposerLayout}
      shellReadyKey={shellReadyKey}
    >
      {isMember ? (
        <ConversationInput
          key={shellReadyKey}
          conversationId={channelId}
          threadId={conversationId ?? ''}
          disabled={!conversationId}
          includeBottomSafeArea={includeBottomSafeArea}
          onSend={handleSend}
          placeholder='Reply to thread...'
        />
      ) : (
        <JoinChannelCard channelId={channelId} />
      )}
    </ChatComposerDock>
  );
});
