import { describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

jest.mock('uuid', () => ({ v7: (): string => 'test-session-id' }));

import { ConversationList } from '@/src/features/chat/v3/list/ConversationList';
import { landingIndex } from '@/src/features/chat/v3/list/landing';
import type { OpenIntent } from '@/src/features/chat/v3/intent/openIntent.types';
import type { OpenState } from '@/src/features/chat/v3/machine/openState';
import { buildRows } from '@/src/features/chat/v3/model/buildRows';
import type { ChatRow } from '@/src/features/chat/v3/model/chatRow.types';
import type { ConversationInput } from '@/src/features/chat/v3/model/conversationInput';

jest.mock('@xyne/shared', () => ({
  ChannelScopeType: { DM: 'DM' },
  parseReactionsMd: (value: string) => {
    const parsed: Record<string, string[]> = {};
    for (const entry of value.split(/[;,]/)) {
      const [emoji, ...users] = entry.trim().split(':');
      if (emoji && users.length > 0) parsed[emoji] = users.filter(Boolean);
    }
    return parsed;
  },
}));

declare global {
  var __chatV3LegendProps: Record<string, unknown> | undefined;
}

jest.mock('@legendapp/list/keyboard', () => {
  // Jest mock factories are hoisted above ESM imports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  const KeyboardAwareLegendList = React.forwardRef<unknown, Record<string, unknown>>(
    function KeyboardAwareLegendList(props: Record<string, unknown>, ref) {
      globalThis.__chatV3LegendProps = props;
      const data = (props['data'] as ChatRow[] | undefined) ?? [];
      React.useImperativeHandle(ref, () => ({
        getState: () => ({
          data,
          start: 0,
          end: Math.max(0, data.length - 1),
          startBuffered: 0,
          endBuffered: Math.max(0, data.length - 1),
          contentLength: data.length * 72,
          scroll: 0,
          scrollLength: data.length * 72,
          isAtEnd: true,
          positionByKey: (key: string) => {
            const index = data.findIndex(item => item.id === key);
            return index >= 0 ? index * 72 : undefined;
          },
          listen: () => () => undefined,
        }),
      }));
      const renderItem = props['renderItem'] as ((...args: unknown[]) => ReactElement) | undefined;
      return React.createElement(
        View,
        { testID: 'chat-v3-legend-list' },
        data.map(item => React.createElement(View, { key: item.id }, renderItem?.({ item }))),
      );
    },
  );
  return {
    KeyboardAwareLegendList,
    useKeyboardScrollToEnd: () => ({ freeze: false, scrollMessageToEnd: jest.fn() }),
    useKeyboardChatComposerInset: () => ({
      contentInsetEndAdjustment: 0,
      onComposerLayout: jest.fn(),
    }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/components/conversation-composer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return {
    ConversationSkeleton: () => React.createElement(View, null),
  };
});

jest.mock('@/src/features/chat/v3/composer/ChatComposerDock', () => ({
  ChatComposerDock: () => null,
}));

jest.mock('@/src/features/chat/v3/composer/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));

jest.mock('react-native-keyboard-controller', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return {
    KeyboardGestureArea: ({ children }: { children: ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/components/conversation-composer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return { ConversationSkeleton: () => React.createElement(View, null) };
});

jest.mock('@/src/features/chat/v3/rows/ChatListRow', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    ChatListRow: ({ row }: { row: ChatRow }) => React.createElement(Text, null, row.id),
  };
});

jest.mock('@/src/utils/flowJsonMarkdown', () => ({
  flowDefinitionToMarkdown: () => '',
  parseFlowJsonParts: () => [],
}));

jest.mock('@/src/theme/useChatRenderTokens', () => ({
  useChatRenderTokens: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/src/theme/chatRenderTokens').DEFAULT_CHAT_RENDER_TOKENS,
}));

jest.mock('@/src/features/chat/v3/composer/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));

jest.mock('@/src/features/chat/v3/composer/ChatComposerDock', () => ({
  ChatComposerDock: () => null,
}));

jest.mock('@/src/features/chat/v3/list/useRowPresentation', () => ({
  useRowPresentation: (rows: readonly ChatRow[]) => ({
    presentedRows: rows,
    onToggleExpand: (): void => undefined,
  }),
}));

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'conversation-1',
  channelId: 'channel-1',
  createdAt: DAY,
  messageId: 'message-1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'USER',
  html: '',
  markdown: 'hello',
  isDeleted: false,
  showInChannel: false,
  isVisibleToCurrentUser: true,
  metadata: null,
  attachments: [],
  ticketPreview: null,
  parentConversationId: null,
  parentMessageId: null,
  parentMarkdown: null,
  replyCount: 0,
  latestReplierIds: [],
  reactionsMd: null,
  linkUrl: null,
  linkTitle: null,
  linkDescription: null,
  forwardedFromName: null,
  forwardedSource: null,
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

const rows = buildRows(
  [
    input(),
    input({
      conversationId: 'conversation-2',
      createdAt: DAY + 2000,
      markdown: 'later',
      messageId: 'message-2',
    }),
  ],
  {
    channelId: 'channel-1',
    channelKind: 'channel',
    currentUserId: 'me',
    unreadBoundaryAt: DAY + 1000,
  },
);

const baseIntent: OpenIntent = {
  intentKey: 'channel:channel-1',
  surface: { kind: 'channel', channelId: 'channel-1' },
  entry: 'tap',
  isColdStart: false,
  raw: {},
  hint: { channelId: 'channel-1' },
};

const noop = (): void => undefined;

const listProps = {
  surface: baseIntent.surface,
  rows,
  composer: { conversationId: 'channel-1', onSend: noop },
  hasReachedStart: false,
  onPaginate: noop,
  onRowEvent: noop,
  onListEvent: noop,
};

const captured = (): Record<string, unknown> => globalThis.__chatV3LegendProps ?? {};

describe('v3 list landing props (P4 render)', () => {
  it('passes initialScrollAtEnd for a tail placing open', () => {
    globalThis.__chatV3LegendProps = undefined;
    const state: OpenState = {
      status: 'placing',
      intent: baseIntent,
      target: { kind: 'tail' },
      source: 'live',
      startedAt: 1,
    };
    render(<ConversationList {...listProps} state={state} />);
    expect(captured()['initialScrollAtEnd']).toBe(true);
    expect(captured()['initialScrollIndex']).toBeUndefined();
  });

  it('keeps a placeholder until a row is actually visible', () => {
    globalThis.__chatV3LegendProps = undefined;
    const onListEvent = jest.fn();
    const state: OpenState = {
      status: 'placing',
      intent: baseIntent,
      target: { kind: 'tail' },
      source: 'warm',
      startedAt: 1,
    };
    render(<ConversationList {...listProps} state={state} onListEvent={onListEvent} />);

    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    act(() => {
      const onLoad = captured()['onLoad'] as (() => void) | undefined;
      onLoad?.();
    });
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();

    const last = rows[rows.length - 1];
    expect(last).toBeDefined();
    act(() => {
      const onFirstVisible = captured()['onFirstVisibleItemChanged'] as
        ((info: { item: ChatRow }) => void) | undefined;
      onFirstVisible?.({ item: last as ChatRow });
    });

    expect(screen.queryByLabelText('Loading messages')).toBeNull();
    expect(onListEvent).toHaveBeenCalledWith({
      type: 'landingConfirmed',
      metrics: { targetPlaced: true },
    });
  });

  it('covers ready rows until one is visible', () => {
    globalThis.__chatV3LegendProps = undefined;
    const state: OpenState = {
      status: 'ready',
      intent: baseIntent,
      target: { kind: 'tail' },
      source: 'warm',
    };
    render(<ConversationList {...listProps} state={state} />);
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    const last = rows[rows.length - 1];
    expect(last).toBeDefined();
    act(() => {
      const onFirstVisible = captured()['onFirstVisibleItemChanged'] as
        ((info: { item: ChatRow }) => void) | undefined;
      onFirstVisible?.({ item: last as ChatRow });
    });
    expect(screen.queryByLabelText('Loading messages')).toBeNull();
  });

  it('does not mount LegendList while resolving, even when rows are already warm', () => {
    globalThis.__chatV3LegendProps = undefined;
    const state: OpenState = {
      status: 'resolving',
      intent: baseIntent,
      startedAt: 1,
    };
    render(<ConversationList {...listProps} state={state} />);
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    expect(screen.queryByTestId('chat-v3-legend-list')).toBeNull();
    expect(captured()['initialScrollAtEnd']).toBeUndefined();
  });

  it('packs an unread placing open at the last message', () => {
    globalThis.__chatV3LegendProps = undefined;
    const state: OpenState = {
      status: 'placing',
      intent: {
        ...baseIntent,
        hint: {
          channelId: 'channel-1',
          unreadBoundaryAt: DAY + 1000,
          unreadBoundaryConversationId: 'conversation-1',
        },
      },
      target: { kind: 'tail' },
      source: 'live',
      startedAt: 1,
    };
    render(<ConversationList {...listProps} state={state} />);
    expect(captured()['initialScrollAtEnd']).toBe(true);
    expect(captured()['initialScrollIndex']).toBeUndefined();
  });

  it('passes initialScrollIndex for an activity/search/deeplink anchor', () => {
    globalThis.__chatV3LegendProps = undefined;
    const target = {
      kind: 'anchor' as const,
      conversationId: 'conversation-2',
      messageId: 'message-2',
      createdAt: DAY + 2000,
    };
    const index = landingIndex(rows, target);
    const state: OpenState = {
      status: 'placing',
      intent: {
        ...baseIntent,
        entry: 'activity',
        hint: {
          channelId: 'channel-1',
          conversationId: 'conversation-2',
          messageId: 'message-2',
          createdAt: DAY + 2000,
        },
      },
      target,
      source: 'live',
      startedAt: 1,
    };
    render(<ConversationList {...listProps} state={state} />);
    expect(index).not.toBeNull();
    expect(captured()['initialScrollAtEnd']).toBe(false);
    expect(captured()['initialScrollIndex']).toEqual({ index, viewPosition: 0.35 });
  });

  it('does not invent an index when the activity anchor is missing from the window', () => {
    globalThis.__chatV3LegendProps = undefined;
    const target = {
      kind: 'anchor' as const,
      conversationId: 'missing',
      messageId: 'missing',
      createdAt: 1,
    };
    const state: OpenState = {
      status: 'placing',
      intent: {
        ...baseIntent,
        entry: 'activity',
        hint: {
          channelId: 'channel-1',
          conversationId: 'missing',
          messageId: 'missing',
          createdAt: 1,
        },
      },
      target,
      source: 'live',
      startedAt: 1,
    };
    render(<ConversationList {...listProps} state={state} />);
    expect(landingIndex(rows, target)).toBeNull();
    expect(captured()['initialScrollIndex']).toBeUndefined();
    expect(screen.queryByTestId('chat-v3-legend-list')).toBeNull();
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    act(() => {
      const onLoad = captured()['onLoad'] as (() => void) | undefined;
      onLoad?.();
    });
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
  });
});
