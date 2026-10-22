/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const AppBottomSheet = React.forwardRef(function AppBottomSheet(
    { children, isOpen, mode }: { children: ReactNode; isOpen: boolean; mode: string },
    ref: React.Ref<{ dismiss: () => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({ dismiss: jest.fn() }));
    return isOpen
      ? React.createElement(
          View,
          { testID: 'app-bottom-sheet', accessibilityLabel: `mode:${mode}` },
          children,
        )
      : null;
  });
  return { AppBottomSheet };
});

import { TicketMetaPickerSheet } from '@/src/screens/ticket-details/ticket-meta-picker-sheet';

describe('TicketMetaPickerSheet', () => {
  it('opens as a fullscreen sheet and renders the title', () => {
    render(
      <TicketMetaPickerSheet isOpen title='Priority' onClose={jest.fn()}>
        {() => null}
      </TicketMetaPickerSheet>,
    );

    expect(screen.getByLabelText('mode:fullscreen')).toBeTruthy();
    expect(screen.getByText('Priority')).toBeTruthy();
  });

  it('stays unmounted while closed', () => {
    render(
      <TicketMetaPickerSheet isOpen={false} title='Priority' onClose={jest.fn()}>
        {() => null}
      </TicketMetaPickerSheet>,
    );

    expect(screen.queryByTestId('app-bottom-sheet')).toBeNull();
  });
});
