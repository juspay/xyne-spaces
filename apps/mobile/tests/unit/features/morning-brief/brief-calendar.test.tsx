/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';

type PickerEvent = { type: 'set' | 'dismissed' };
type PickerProps = {
  value: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  onChange: (event: PickerEvent, date?: Date) => void;
};

// Capture the native picker's props so tests can drive onChange directly —
// the real component is a platform view with no testable surface in jest.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const captured: { props: PickerProps | null } = { props: null };
  const Picker = (props: PickerProps): React.ReactElement => {
    captured.props = props;
    return React.createElement(View, { testID: 'native-date-picker' });
  };
  return { __esModule: true, default: Picker, __captured: captured };
});

jest.mock('@/src/utils/toast', () => ({
  showMessageToast: jest.fn(),
}));

import { BriefCalendar } from '@/src/features/morning-brief/components/BriefCalendar';
import { showMessageToast } from '@/src/utils/toast';

const { __captured: captured } = jest.requireMock('@react-native-community/datetimepicker') as {
  __captured: { props: PickerProps | null };
};

const AVAILABLE = ['2026-08-30', '2026-08-31', '2026-09-01'];

function renderCalendar(overrides: Partial<Parameters<typeof BriefCalendar>[0]> = {}): {
  onSelect: jest.Mock;
  onDismiss: jest.Mock;
} {
  const onSelect = jest.fn();
  const onDismiss = jest.fn();
  render(
    <BriefCalendar
      availableDates={AVAILABLE}
      selectedDate='2026-09-01'
      onSelect={onSelect}
      onDismiss={onDismiss}
      mutedColor='#666666'
      accentColor='#fe6d36'
      {...overrides}
    />,
  );
  return { onSelect, onDismiss };
}

describe('BriefCalendar (native picker)', () => {
  it('renders the native picker clamped to the available range', () => {
    renderCalendar();
    expect(screen.getByTestId('native-date-picker')).toBeTruthy();
    expect(captured.props?.minimumDate).toEqual(new Date('2026-08-30T00:00:00'));
    expect(captured.props?.maximumDate).toEqual(new Date('2026-09-01T00:00:00'));
    expect(captured.props?.value).toEqual(new Date('2026-09-01T00:00:00'));
  });

  it('selects a day that has a brief', () => {
    const { onSelect } = renderCalendar();
    act(() => captured.props?.onChange({ type: 'set' }, new Date('2026-08-31T00:00:00')));
    expect(onSelect).toHaveBeenCalledWith('2026-08-31');
  });

  it('toasts instead of navigating for a day without a brief', () => {
    const { onSelect } = renderCalendar();
    // Min/max clamp months, not individual days — a gap day is still pickable.
    act(() => captured.props?.onChange({ type: 'set' }, new Date('2026-08-30T12:00:00')));
    expect(onSelect).toHaveBeenCalledWith('2026-08-30');
    act(() => captured.props?.onChange({ type: 'set' }, new Date('2026-08-29T00:00:00')));
    expect(showMessageToast).toHaveBeenCalledWith('No brief for that day.');
    expect(onSelect).not.toHaveBeenCalledWith('2026-08-29');
  });

  it('reports a dismissed dialog so the sheet returns to the list', () => {
    const { onSelect, onDismiss } = renderCalendar();
    act(() => captured.props?.onChange({ type: 'dismissed' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the empty message when no briefs exist', () => {
    renderCalendar({ availableDates: [] });
    expect(screen.getByText('No briefs yet.')).toBeTruthy();
    expect(screen.queryByTestId('native-date-picker')).toBeNull();
  });
});
