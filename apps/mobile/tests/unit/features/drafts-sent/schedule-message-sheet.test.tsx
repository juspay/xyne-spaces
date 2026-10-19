/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import type { ReactNode } from 'react';

jest.mock('uniwind', () => ({
  useCSSVariable: (name: string) => {
    if (name === '--color-border') return '#cccccc';
    return '#111111';
  },
}));

jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({
    accentBg: '#3366ff',
    accentFg: '#ffffff',
    accentSoft: '#ccd9ff',
    accentText: '#2244cc',
  }),
}));

jest.mock('@/src/utils/haptics', () => ({
  haptics: {
    success: jest.fn(),
    selection: jest.fn(),
    buttonTap: jest.fn(),
    longPress: jest.fn(),
    warning: jest.fn(),
    gestureStart: jest.fn(),
    gestureEnd: jest.fn(),
  },
}));

jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AppBottomSheet: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? React.createElement(View, { accessibilityLabel: 'schedule-sheet' }, children) : null,
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

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'datetime-picker'),
  };
});

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    Calendar: () => React.createElement(Text, null, 'calendar-icon'),
    Check: () => React.createElement(Text, null, 'check-icon'),
    Clock: () => React.createElement(Text, null, 'clock-icon'),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import { ScheduleMessageSheet } from '@/src/features/drafts-sent/schedule-message-sheet';

describe('ScheduleMessageSheet', () => {
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

  it('shows Schedule message title in create mode', () => {
    render(
      <ScheduleMessageSheet
        isOpen
        mode='create'
        onOpenChange={jest.fn()}
        onConfirm={jest.fn<(scheduledFor: number) => void>()}
      />,
    );

    expect(screen.getByText('Schedule message')).toBeTruthy();
    expect(screen.queryByText('Reschedule message')).toBeNull();
  });

  it('shows Reschedule message title in reschedule mode', () => {
    render(
      <ScheduleMessageSheet
        isOpen
        mode='reschedule'
        initialScheduledFor={tomorrow}
        onOpenChange={jest.fn()}
        onConfirm={jest.fn<(scheduledFor: number) => void>()}
      />,
    );

    expect(screen.getByText('Reschedule message')).toBeTruthy();
  });

  it('opens custom time without a Back button', () => {
    render(
      <ScheduleMessageSheet
        isOpen
        mode='create'
        onOpenChange={jest.fn()}
        onConfirm={jest.fn<(scheduledFor: number) => void>()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Custom time'));

    expect(screen.getByLabelText('Continue')).toBeTruthy();
    expect(screen.getByLabelText('Choose date')).toBeTruthy();
    expect(screen.getByLabelText('Choose time')).toBeTruthy();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('keeps Back on the confirm step only', () => {
    render(
      <ScheduleMessageSheet
        isOpen
        mode='create'
        onOpenChange={jest.fn()}
        onConfirm={jest.fn<(scheduledFor: number) => void>()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Tomorrow 9:00 AM'));

    expect(screen.getByLabelText('Schedule')).toBeTruthy();
    expect(screen.getByLabelText('Back')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Back'));

    expect(screen.getByLabelText('Tomorrow 9:00 AM')).toBeTruthy();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('uses Reschedule confirm CTA in reschedule mode', () => {
    render(
      <ScheduleMessageSheet
        isOpen
        mode='reschedule'
        initialScheduledFor={tomorrow}
        onOpenChange={jest.fn()}
        onConfirm={jest.fn<(scheduledFor: number) => void>()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Tomorrow 9:00 AM'));

    expect(screen.getByLabelText('Reschedule')).toBeTruthy();
    expect(screen.getByText(/This message will be rescheduled to/)).toBeTruthy();
  });

  it('confirms a preset and closes on success', async () => {
    const onConfirm = jest.fn<(scheduledFor: number) => Promise<void>>(async () => undefined);
    const onOpenChange = jest.fn();

    render(
      <ScheduleMessageSheet
        isOpen
        mode='create'
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.press(screen.getByLabelText('Tomorrow 9:00 AM'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Schedule'));
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(typeof onConfirm.mock.calls[0]?.[0]).toBe('number');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an iOS Done control for the date picker, not on Android', () => {
    const original = Platform.OS;

    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
      const { unmount } = render(
        <ScheduleMessageSheet
          isOpen
          mode='create'
          onOpenChange={jest.fn()}
          onConfirm={jest.fn<(scheduledFor: number) => void>()}
        />,
      );
      fireEvent.press(screen.getByLabelText('Custom time'));
      fireEvent.press(screen.getByLabelText('Choose date'));
      expect(screen.getByLabelText('Done selecting schedule time')).toBeTruthy();
      unmount();

      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      render(
        <ScheduleMessageSheet
          isOpen
          mode='create'
          onOpenChange={jest.fn()}
          onConfirm={jest.fn<(scheduledFor: number) => void>()}
        />,
      );
      fireEvent.press(screen.getByLabelText('Custom time'));
      fireEvent.press(screen.getByLabelText('Choose date'));
      expect(screen.queryByLabelText('Done selecting schedule time')).toBeNull();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
    }
  });
});
