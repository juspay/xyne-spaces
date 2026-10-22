import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

jest.mock('uuid', () => ({ v7: (): string => 'test-session-id' }));

import { ConversationList } from '@/src/features/chat/v3/list/ConversationList';
import { ListEmpty } from '@/src/features/chat/v3/list/ListEmpty';
import { ListError } from '@/src/features/chat/v3/list/ListError';
import { ListSkeleton } from '@/src/features/chat/v3/list/ListSkeleton';
import type { OpenIntent } from '@/src/features/chat/v3/intent/openIntent.types';
import type { OpenState } from '@/src/features/chat/v3/machine/openState';
import type { ChatRow } from '@/src/features/chat/v3/model/chatRow.types';

jest.mock('@legendapp/list/keyboard', () => {
  // Jest mock factories are hoisted above ESM imports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  const KeyboardAwareLegendList = React.forwardRef(function KeyboardAwareLegendList(
    props: {
      data?: ChatRow[];
      renderItem?: (info: { item: ChatRow }) => ReactElement;
      onLoad?: () => void;
      onFirstVisibleItemChanged?: (info: { item: ChatRow }) => void;
    },
    ref: unknown,
  ) {
    void ref;
    const { data = [], onLoad, onFirstVisibleItemChanged, renderItem } = props;
    React.useEffect(() => {
      if (data.length > 0) {
        onLoad?.();
        const last = data[data.length - 1];
        if (last) {
          onFirstVisibleItemChanged?.({ item: last });
        }
      }
    }, [data, onFirstVisibleItemChanged, onLoad]);
    return React.createElement(
      View,
      { testID: 'chat-v3-legend-list' },
      data.map(item => React.createElement(View, { key: item.id }, renderItem?.({ item }))),
    );
  });
  return {
    KeyboardAwareLegendList,
    useKeyboardScrollToEnd: () => ({ freeze: false, scrollMessageToEnd: jest.fn() }),
    useKeyboardChatComposerInset: () => ({
      contentInsetEndAdjustment: 0,
      onComposerLayout: jest.fn(),
    }),
  };
});

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

jest.mock('@/src/features/chat/v3/composer/ChatComposerDock', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return {
    ChatComposerDock: () => React.createElement(View, { testID: 'chat-v3-composer-dock' }),
  };
});

jest.mock('@/src/features/chat/v3/composer/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));
jest.mock('@/src/features/chat/v3/rows/ChatListRow', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    ChatListRow: ({ row }: { row: ChatRow }) => React.createElement(Text, null, row.id),
  };
});

jest.mock('@/src/components/conversation-composer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  return {
    ConversationSkeleton: () =>
      React.createElement(View, { accessibilityLabel: 'Loading older messages' }),
  };
});

jest.mock('@/src/features/chat/v3/composer/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));

jest.mock('@/src/features/chat/v3/composer/ChatComposerDock', () => ({
  ChatComposerDock: () => null,
}));

jest.mock('@/src/theme/useChatRenderTokens', () => ({
  useChatRenderTokens: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/src/theme/chatRenderTokens').DEFAULT_CHAT_RENDER_TOKENS,
}));

jest.mock('@/src/features/chat/v3/list/useRowPresentation', () => ({
  useRowPresentation: (rows: readonly ChatRow[]) => ({
    presentedRows: rows,
    onToggleExpand: (): void => undefined,
  }),
}));

const intent: OpenIntent = {
  intentKey: 'channel:c1',
  surface: { kind: 'channel', channelId: 'c1' },
  entry: 'tap',
  isColdStart: false,
  raw: {},
  hint: { channelId: 'c1' },
};

const noop = (): void => undefined;

const listProps = {
  surface: intent.surface,
  rows: [] as ChatRow[],
  composer: { conversationId: 'c1', onSend: noop },
  hasReachedStart: false,
  onPaginate: noop,
  onRowEvent: noop,
  onListEvent: noop,
};

describe('v3 list chrome', () => {
  it('mounts the error, skeleton, and empty surfaces', () => {
    const error = render(<ListError failure={{ reason: 'timeout', stage: 'loading' }} />);
    expect(screen.getByText('Could not load messages')).toBeTruthy();
    error.unmount();

    const skeleton = render(<ListSkeleton />);
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    skeleton.unmount();

    render(<ListEmpty />);
    expect(screen.getByText('No messages yet')).toBeTruthy();
  });

  it('shows exactly one of error, skeleton, empty, or rows (I1–I4)', () => {
    const errorState: OpenState = {
      status: 'error',
      intent,
      failure: { reason: 'timeout', stage: 'loading' },
    };
    const { unmount: unmountError } = render(
      <ConversationList {...listProps} state={errorState} />,
    );
    expect(screen.getByText('Could not load messages')).toBeTruthy();
    expect(screen.queryByLabelText('Loading messages')).toBeNull();
    expect(screen.queryByText('No messages yet')).toBeNull();
    unmountError();

    const loadingState: OpenState = {
      status: 'loading',
      intent,
      target: { kind: 'tail' },
      startedAt: 1,
    };
    const { unmount: unmountLoading } = render(
      <ConversationList {...listProps} state={loadingState} />,
    );
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No messages yet')).toBeNull();
    unmountLoading();

    const resolvingState: OpenState = {
      status: 'resolving',
      intent,
      startedAt: 1,
    };
    const resolvingRows: ChatRow[] = [{ type: 'date', id: 'd-resolving', date: 1 }];
    const { unmount: unmountResolving } = render(
      <ConversationList {...listProps} state={resolvingState} rows={resolvingRows} />,
    );
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    expect(screen.queryByTestId('chat-v3-legend-list')).toBeNull();
    unmountResolving();

    const readyEmpty: OpenState = {
      status: 'ready',
      intent,
      target: { kind: 'tail' },
      source: 'live',
    };
    const { unmount: unmountEmpty } = render(
      <ConversationList {...listProps} state={readyEmpty} />,
    );
    expect(screen.getByText('No messages yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText('Loading messages')).toBeNull();
    unmountEmpty();

    const placing: OpenState = {
      status: 'placing',
      intent,
      target: { kind: 'tail' },
      source: 'warm',
      startedAt: 1,
    };
    const rows: ChatRow[] = [{ type: 'date', id: 'd1', date: 1 }];
    render(<ConversationList {...listProps} state={placing} rows={rows} />);
    expect(screen.getByText('d1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText('Loading messages')).toBeNull();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });
});
