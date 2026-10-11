/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  type Metrics,
} from 'react-native-safe-area-context';

jest.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({
    joinCommunityAndSwitch: jest.fn(),
    createOrganization: jest.fn(),
    createEnterpriseWorkspace: jest.fn(),
    requestEnterpriseJoin: jest.fn(),
  }),
}));

// MMKV is native-only; progress always reads back empty here, which is the fresh-deck case.
jest.mock('@/src/services/localStorage', () => ({
  getJson: () => null,
  setJson: () => undefined,
  deleteKeys: () => undefined,
}));

// Layout animations need the native runtime; a plain View with chainable builders is enough to
// exercise the deck's structure.
jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native') as typeof import('react-native');
  const builder: { duration: () => unknown; delay: () => unknown } = {
    duration: (): unknown => builder,
    delay: (): unknown => builder,
  };
  return {
    __esModule: true,
    default: { View, Text },
    FadeIn: builder,
    FadeOut: builder,
    SlideInLeft: builder,
    SlideInRight: builder,
  };
});

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [{ orgId: 'org-1', orgName: 'Xyne', workspaces: [{ id: 'ws-1', name: 'Xyne' }] }],
  }),
}));

import { OnboardingScreen } from '@/src/features/onboarding';
import type { OnboardingContext } from '@/src/features/onboarding';

const METRICS: Metrics = initialWindowMetrics ?? {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CONTEXT: OnboardingContext = {
  email: 'devesh@acme.com',
  profileName: 'Devesh',
  existingCompany: null,
  publicEmailDomainError: null,
  isInvited: false,
};

function renderDeck(context: OnboardingContext = CONTEXT): ReactElement {
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OnboardingScreen context={context} />
    </SafeAreaProvider>,
  );
  return <></>;
}

describe('OnboardingScreen', () => {
  it('greets the person before the deck', () => {
    renderDeck();
    expect(screen.getByText('Welcome to Xyne Spaces, Devesh')).toBeTruthy();
  });

  it('drops the name from the greeting when no provider gave one', () => {
    renderDeck({ ...CONTEXT, profileName: null });
    expect(screen.getByText('Welcome to Xyne Spaces')).toBeTruthy();
  });

  it('opens the first card once the greeting has played', () => {
    jest.useFakeTimers();
    renderDeck();

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(screen.getByText('Where do you want to start?')).toBeTruthy();
    jest.useRealTimers();
  });

  it('grows the deck when the workspace branch is picked', () => {
    jest.useFakeTimers();
    renderDeck();
    act(() => {
      jest.advanceTimersByTime(2500);
    });

    // Three cards on the community path: start, role, connect-tools.
    expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Join or create workspace'));

    // The workspace branch adds the setup card, so the dots gain one.
    expect(screen.getByLabelText('Step 1 of 4')).toBeTruthy();
    jest.useRealTimers();
  });
});
