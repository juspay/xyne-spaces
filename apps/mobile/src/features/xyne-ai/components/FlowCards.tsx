import { useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import type { FlowDefinition } from '@xyne/shared';

import { buildBlockMarkdownStyle } from '@/src/features/chat/v3/rows/blockMarkdownStyle';
import { FlowJsonMessageBody } from '@/src/features/chat/v3/rows/parts/FlowJsonMessageBody';
import { useChatRenderTokens } from '@/src/features/chat/v3/theme/ChatRenderProvider';

import { flowMessageId } from '../model/uiFlows';

/** The agent's interactive cards (plans, questions, approvals), rendered like they are in chat. */
export const FlowCards = ({
  flows,
  conversationId,
  messageId,
  viewerId,
  onOpenUrl,
  onClose,
}: {
  flows: FlowDefinition[];
  conversationId: string;
  messageId: string | undefined;
  viewerId: string;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}): ReactElement => {
  const tokens = useChatRenderTokens();
  const markdownStyle = useMemo(
    () =>
      buildBlockMarkdownStyle({
        foreground: tokens.rootTextOther,
        foregroundMuted: tokens.foregroundMuted,
        cardBg: tokens.cardBg,
        brand: tokens.brand,
        link: tokens.linkColor,
        tableHeaderBackground: tokens.tableHeaderBg,
        tableBorderColor: tokens.tableBorderColor,
      }),
    [tokens],
  );

  return (
    <View className='gap-3'>
      {flows.map(flow => (
        <FlowJsonMessageBody
          key={flow.screenId}
          flow={flow}
          model={{
            conversationId,
            messageId: flowMessageId(flow, messageId),
            messageType: 'BOT',
            viewerId,
          }}
          markdownStyle={markdownStyle}
          mine={false}
          onOpenUrl={onOpenUrl}
          onClose={onClose}
        />
      ))}
    </View>
  );
};
