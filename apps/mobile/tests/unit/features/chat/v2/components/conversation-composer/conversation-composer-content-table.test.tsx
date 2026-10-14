import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

const mockMarkdownBody = jest.fn((_props: unknown) => null);
const mockUseConversationComposer = jest.fn();

jest.mock(
  '@/src/features/chat/v2/components/conversation-composer/conversation-composer-context',
  () => ({ useConversationComposer: () => mockUseConversationComposer() }),
);
jest.mock(
  '@/src/features/chat/v2/components/conversation-composer/conversation-composer-markdown-body',
  () => ({
    ConversationComposerMarkdownBody: (props: unknown) => mockMarkdownBody(props),
  }),
);
jest.mock('@/src/features/chat/v2/components/conversation-composer/flow-json-message', () => ({
  FlowJsonActionRow: () => null,
  FlowJsonMessageParts: () => null,
}));
jest.mock('@/src/features/chat/v2/components/conversation-composer/utils/htmlToMD', () => ({
  htmlToMD: (value: string) => value,
  normalizeActivityPreviewMarkdown: (value: string) => value,
}));
jest.mock('@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle', () => ({
  buildComposerMarkdownStyle: () => ({ paragraph: {} }),
}));
jest.mock('@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress', () => ({
  useMentionPress: () => jest.fn(),
}));
jest.mock('@/src/features/chat/v2/components/conversation-composer/utils/debug-boundary', () => ({
  DebugBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock(
  '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse',
  () => ({
    getLongMessageCollapseModel: () => ({ collapsedNumberOfLines: 6 }),
    shouldCollapseMessageBody: () => false,
  }),
);
jest.mock(
  '@/src/features/chat/v2/components/conversation-composer/utils/useFlowNormalizationOptions',
  () => ({ useFlowNormalizationOptions: () => ({}) }),
);
jest.mock(
  '@xyne/shared',
  () => ({
    MessageType: { FORWARDED: 'FORWARDED' },
    parseTicketMd: () => null,
  }),
  { virtual: true },
);
jest.mock('@/src/features/chat/v2/components/chat/message-row', () => ({
  useChatRenderTokens: () => ({
    actionPrimaryColor: '#0a0',
    inlineContentMaxWidth: 300,
    linkColor: '#0a0',
    linkColorUser: '#0a0',
    rootTextUser: '#111',
    tableBorderColor: '#333',
    tableHeaderBg: '#222',
  }),
}));
jest.mock('@/src/features/chat/v2/paint/chatPaintSizing', () => ({
  CHAT_BUBBLE_HORIZONTAL_PADDING_PX: 16,
}));
jest.mock('@/src/utils/flowJsonMarkdown', () => ({
  flowDefinitionToMarkdown: () => '',
  parseFlowJsonParts: () => [],
}));
jest.mock('@/src/utils/flowPrUtils', () => ({ isPrFlow: () => false }));
jest.mock('@/src/utils/flowCallScheduleUtils', () => ({ isCallScheduleFlow: () => false }));
jest.mock('@/src/utils/flowChartUtils', () => ({ isChartFlow: () => false }));
jest.mock('@/src/utils/flowMcpSuggestUtils', () => ({ isMcpSuggestFlow: () => false }));
jest.mock('@/src/utils/flowDiffUtils', () => ({ isDiffFlow: () => false }));
jest.mock('uniwind', () => ({ useCSSVariable: () => '#111' }));

import { Content } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-content';

const TABLE_MARKDOWN = ['Ticket | Priority', '--- | ---', 'XYNE-62465 | HIGH'].join('\n');

describe('ConversationComposer.Content table rendering', () => {
  beforeEach(() => {
    mockMarkdownBody.mockClear();
    mockUseConversationComposer.mockReturnValue({
      item: { conversationId: 'conversation-1', ticket_md: null },
      kind: 'OTHER_USER',
      summary: { content: TABLE_MARKDOWN, msgType: 'TEXT' },
      forwarded: null,
      currentUser: { id: 'user-1' },
      contentVariant: 'primary',
      paintRow: {
        body: {
          markdown: TABLE_MARKDOWN,
          collapse: { isCollapsible: false, collapsedLines: 6 },
        },
        ticketPreview: null,
      },
      allowInlineEmojiHydration: true,
      isContentExpanded: false,
      onContentExpanded: undefined,
      suppressBubblePress: jest.fn(),
    });
  });

  it('selects the github flavor from the exact markdown rendered by the rich path', () => {
    render(<Content />);

    expect(mockMarkdownBody).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: TABLE_MARKDOWN, flavor: 'github' }),
    );
  });
});
