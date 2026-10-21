/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('uniwind', () => ({
  useCSSVariable: () => '#888888',
}));

jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentBg: '#000000' }),
}));

jest.mock('@/src/utils/haptics', () => ({
  haptics: { selection: jest.fn() },
}));

jest.mock('@/src/utils/channel-utils', () => ({
  getUserDisplayName: (user: { name: string }) => user.name,
}));

jest.mock('@/src/utils/statusUtils', () => ({
  isUserDeactivated: () => false,
}));

jest.mock('@/src/components/ui/avatar', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'avatar' }),
  };
});

jest.mock('@/src/screens/ticket-details/use-assignee-picker-candidates', () => ({
  useAssigneePickerCandidates: () => ({
    candidates: [{ id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com' }],
    emptyLabel: 'No members found',
  }),
}));

jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const AppBottomSheet = React.forwardRef(function AppBottomSheet(
    { children, isOpen }: { children: ReactNode; isOpen: boolean },
    ref: React.Ref<{ dismiss: () => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({ dismiss: jest.fn() }));
    return isOpen ? React.createElement(View, null, children) : null;
  });
  return { AppBottomSheet };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    useBottomSheetInternal: () => null,
    BottomSheetFlatList: ({
      data,
      renderItem,
      ListHeaderComponent,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => ReactNode;
      ListHeaderComponent?: ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        ListHeaderComponent,
        data.map((item, index) =>
          React.createElement(View, { key: String(index) }, renderItem({ item })),
        ),
      ),
  };
});

import { UserPickerSheet } from '@/src/screens/ticket-details/user-picker-sheet';

describe('UserPickerSheet', () => {
  it('calls onSelect(null) when Unassigned is pressed', () => {
    const onSelect = jest.fn();
    render(
      <UserPickerSheet
        isOpen
        channelId='ch-1'
        selectedUserId='u-1'
        isUnassigned={false}
        onClose={jest.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByLabelText('Unassigned'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect with the user id when a member row is pressed', () => {
    const onSelect = jest.fn();
    render(
      <UserPickerSheet
        isOpen
        channelId='ch-1'
        selectedUserId={null}
        isUnassigned
        onClose={jest.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByText('Ada Lovelace'));
    expect(onSelect).toHaveBeenCalledWith('u-1');
  });
});
