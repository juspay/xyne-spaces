/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AppBottomSheet: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? React.createElement(View, null, children) : null,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { TextInput, View } = require('react-native') as typeof import('react-native');
  return {
    BottomSheetView: ({ children }: { children: ReactNode }) =>
      React.createElement(View, null, children),
    BottomSheetTextInput: (props: Record<string, unknown>) => React.createElement(TextInput, props),
  };
});

jest.mock('@/src/components/ui/switch', () => {
  const React = require('react') as typeof import('react');
  const { Pressable } = require('react-native') as typeof import('react-native');
  return {
    Switch: ({
      isSelected,
      onSelectedChange,
    }: {
      isSelected: boolean;
      onSelectedChange: (value: boolean) => void;
    }) =>
      React.createElement(Pressable, {
        accessibilityRole: 'switch',
        accessibilityState: { checked: isSelected },
        onPress: () => onSelectedChange(!isSelected),
      }),
  };
});

import { BriefSettingsSheet } from '@/src/features/morning-brief/components/BriefSettingsSheet';
import { DAILY_BRIEF_INSTRUCTIONS_LIMIT } from '@/src/features/morning-brief/api/dailyBriefApi';

const CONFIG = {
  enabled: true,
  instructions: 'Keep it short.',
  instructionsEnabled: false,
  updatedAt: null,
};

function renderSheet(overrides: Partial<Parameters<typeof BriefSettingsSheet>[0]> = {}): {
  onSave: jest.Mock;
  onOpenChange: jest.Mock;
} {
  const onSave = jest.fn();
  const onOpenChange = jest.fn();
  render(
    <BriefSettingsSheet
      isOpen
      onOpenChange={onOpenChange}
      config={CONFIG}
      saving={false}
      busy={false}
      onSave={onSave}
      foregroundColor='#111111'
      mutedColor='#666666'
      borderColor='#dddddd'
      {...overrides}
    />,
  );
  return { onSave, onOpenChange };
}

describe('BriefSettingsSheet', () => {
  it('seeds the form from the saved config', () => {
    renderSheet();
    expect(screen.getByDisplayValue('Keep it short.')).toBeTruthy();
    const [enabledSwitch, instructionsSwitch] = screen.getAllByRole('switch');
    expect(enabledSwitch?.props['accessibilityState'].checked).toBe(true);
    expect(instructionsSwitch?.props['accessibilityState'].checked).toBe(false);
  });

  it('always sends instructionsEnabled explicitly on save', () => {
    const { onSave, onOpenChange } = renderSheet();
    fireEvent.press(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(
      { enabled: true, instructions: 'Keep it short.', instructionsEnabled: false },
      false,
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes the regenerate flag for Save & regenerate', () => {
    const { onSave } = renderSheet();
    fireEvent.press(screen.getByText('Save & regenerate'));
    expect(onSave).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('sends toggled switch values', () => {
    const { onSave } = renderSheet();
    const [enabledSwitch, instructionsSwitch] = screen.getAllByRole('switch');
    fireEvent.press(enabledSwitch!);
    fireEvent.press(instructionsSwitch!);
    fireEvent.press(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(
      { enabled: false, instructions: 'Keep it short.', instructionsEnabled: true },
      false,
    );
  });

  it('blocks saving when the instructions exceed the limit', () => {
    const { onSave } = renderSheet();
    fireEvent.changeText(
      screen.getByDisplayValue('Keep it short.'),
      'x'.repeat(DAILY_BRIEF_INSTRUCTIONS_LIMIT + 1),
    );
    fireEvent.press(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('has no Cancel button — the sheet closes by drag or backdrop tap', () => {
    renderSheet();
    expect(screen.queryByText('Cancel')).toBeNull();
  });
});
