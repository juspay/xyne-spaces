/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
    BottomSheetFlatList: ({
      data,
      renderItem,
      ListEmptyComponent,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => ReactNode;
      ListEmptyComponent?: ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) =>
              React.createElement(View, { key: String(index) }, renderItem({ item })),
            ),
      ),
  };
});

import { SingleSelectPickerSheet } from '@/src/screens/ticket-details/single-select-picker-sheet';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Delta' },
] as const;

describe('SingleSelectPickerSheet', () => {
  it('caps visible options with maxVisibleOptions', () => {
    render(
      <SingleSelectPickerSheet
        isOpen
        title='Board'
        options={OPTIONS}
        selectedValue={null}
        onClose={jest.fn()}
        onSelect={jest.fn()}
        maxVisibleOptions={2}
      />,
    );

    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.queryByText('Charlie')).toBeNull();
    expect(screen.queryByText('Delta')).toBeNull();
  });

  it('invokes onSelect when a row is pressed', () => {
    const onSelect = jest.fn();
    render(
      <SingleSelectPickerSheet
        isOpen
        title='Board'
        options={OPTIONS}
        selectedValue={null}
        onClose={jest.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByText('Charlie'));
    expect(onSelect).toHaveBeenCalledWith('c');
  });
});
