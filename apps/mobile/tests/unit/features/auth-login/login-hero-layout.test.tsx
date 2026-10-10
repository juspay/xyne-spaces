/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  type Metrics,
} from 'react-native-safe-area-context';

// expo-image's module side effects reach for a native observer that jest-expo does not provide.
// The avatars are decorative here, so a plain View stands in for them.
jest.mock('expo-image', () => ({ Image: require('react-native').View }));

import { LoginHeroLayout } from '@/src/features/auth-login';

const METRICS: Metrics = initialWindowMetrics ?? {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderScreen(element: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
}

describe('LoginHeroLayout', () => {
  it('renders the headline and the three providers', () => {
    renderScreen(<LoginHeroLayout onSelectProvider={jest.fn()} />);

    expect(screen.getByLabelText('The most future-proof way to bring AI to your Org')).toBeTruthy();
    expect(screen.getByLabelText('Continue with Google')).toBeTruthy();
    expect(screen.getByLabelText('Continue with Microsoft')).toBeTruthy();
    expect(screen.getByLabelText('Continue with email')).toBeTruthy();
  });

  it('reports the provider that was tapped', () => {
    const onSelectProvider = jest.fn();
    renderScreen(<LoginHeroLayout onSelectProvider={onSelectProvider} />);

    fireEvent.press(screen.getByLabelText('Continue with email'));

    expect(onSelectProvider).toHaveBeenCalledWith('email');
  });

  it('does not fire while disabled', () => {
    const onSelectProvider = jest.fn();
    renderScreen(<LoginHeroLayout onSelectProvider={onSelectProvider} disabled />);

    fireEvent.press(screen.getByLabelText('Continue with Google'));

    expect(onSelectProvider).not.toHaveBeenCalled();
  });
});
