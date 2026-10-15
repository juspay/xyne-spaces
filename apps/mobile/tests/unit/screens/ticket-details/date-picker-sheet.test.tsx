/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('uniwind', () => ({
  useCSSVariable: () => '#888888',
}));

jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentBg: '#111111', accentFg: '#ffffff' }),
}));

jest.mock('@/src/utils/haptics', () => ({
  haptics: { selection: jest.fn() },
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: function MockDateTimePicker() {
      return React.createElement(View, { testID: 'datetime-picker' });
    },
  };
});

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

import { DatePickerSheet } from '@/src/screens/ticket-details/date-picker-sheet';

describe('DatePickerSheet', () => {
  const valueMs = new Date(2024, 8, 17, 15, 30).getTime();

  it('renders the selected preview and Save for datetime mode', () => {
    Platform.OS = 'ios';
    render(
      <DatePickerSheet
        isOpen
        title='Due Date'
        value={valueMs}
        mode='datetime'
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText('Due Date')).toBeTruthy();
    expect(screen.getByText('Selected')).toBeTruthy();
    expect(screen.getByText('17 Sep, 3:30 PM')).toBeTruthy();
    expect(screen.getByLabelText('Save due date')).toBeTruthy();
  });

  it('hides Clear when allowClear is false (ticket eta write path)', () => {
    render(
      <DatePickerSheet
        isOpen
        title='Due Date'
        value={valueMs}
        mode='datetime'
        allowClear={false}
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Clear due date')).toBeNull();
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('shows Clear when allowClear is true and a value is set', () => {
    const onSelect = jest.fn();
    render(
      <DatePickerSheet
        isOpen
        title='Due Date'
        value={valueMs}
        mode='datetime'
        allowClear
        onClose={jest.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByLabelText('Clear due date'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('confirms the current draft via Save', () => {
    const onSelect = jest.fn();
    render(
      <DatePickerSheet
        isOpen
        title='Status Deadline'
        value={valueMs}
        mode='datetime'
        onClose={jest.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByLabelText('Save status deadline'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(valueMs);
  });

  it('stays unmounted while closed', () => {
    render(
      <DatePickerSheet
        isOpen={false}
        title='Due Date'
        value={valueMs}
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.queryByText('Due Date')).toBeNull();
    expect(screen.queryByLabelText('Save due date')).toBeNull();
  });
});
