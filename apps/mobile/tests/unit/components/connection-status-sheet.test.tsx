/**
 * Rendering test for the live-sync explainer sheet: real copy and layout over a
 * stubbed bottom sheet, router, theme and icons.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('uniwind', () => ({ useCSSVariable: (name: string) => `var(${name})` }));
jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({
    accentBg: '#2563eb',
    accentFg: '#ffffff',
    accentSoft: '#dbeafe',
    accentText: '#1d4ed8',
  }),
}));
jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});
jest.mock('@/src/utils/haptics', () => ({ haptics: { buttonTap: jest.fn() } }));
jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AppBottomSheet: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? React.createElement(View, { testID: 'sheet' }, children) : null,
  };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    BottomSheetScrollView: ({ children }: { children: ReactNode }) =>
      React.createElement(View, null, children),
  };
});

import { ConnectionStatusSheet } from '@/src/components/connection-status-sheet';

describe('ConnectionStatusSheet', () => {
  it('renders nothing while closed', () => {
    render(
      <ConnectionStatusSheet
        isOpen={false}
        onOpenChange={jest.fn()}
        stateName='connected'
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('explains the current state and lists every state, marking the current one', () => {
    render(
      <ConnectionStatusSheet
        isOpen
        onOpenChange={jest.fn()}
        stateName='disconnected'
        reason='socket closed'
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByText('Live sync')).toBeTruthy();
    expect(screen.getByLabelText('Status: Disconnected')).toBeTruthy();
    expect(screen.getByText(/Check your network, then tap Refresh/)).toBeTruthy();
    expect(screen.getByText(/No live connection/)).toBeTruthy();
    expect(screen.getByText(/Details: socket closed/)).toBeTruthy();
    expect(screen.getByText(/Disconnected\s+·\s+now/)).toBeTruthy();
    expect(screen.getByText(/\(Zero\)/)).toBeTruthy();
    for (const label of ['Connected', 'Connecting', 'Signing in again', 'Error', 'Closed']) {
      expect(screen.getByLabelText(new RegExp(`^${label}:`))).toBeTruthy();
    }
  });

  it('refreshes and closes from the Refresh button', () => {
    const onRefresh = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <ConnectionStatusSheet
        isOpen
        onOpenChange={onOpenChange}
        stateName='error'
        onRefresh={onRefresh}
      />,
    );

    fireEvent.press(screen.getByLabelText('Refresh'));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hides the instruction, Refresh and details while connected', () => {
    render(
      <ConnectionStatusSheet
        isOpen
        onOpenChange={jest.fn()}
        stateName='connected'
        reason='ignored'
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Refresh')).toBeNull();
    expect(screen.queryByText(/Details:/)).toBeNull();
    expect(screen.queryByText('Nothing to do.')).toBeNull();
  });

  it('opens the sync guide and closes', () => {
    const onOpenChange = jest.fn();
    render(
      <ConnectionStatusSheet
        isOpen
        onOpenChange={onOpenChange}
        stateName='connecting'
        onRefresh={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Read the guide about staying in sync'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(protected)/guide/[guideId]',
      params: { guideId: 'sync-status' },
    });
  });
});
