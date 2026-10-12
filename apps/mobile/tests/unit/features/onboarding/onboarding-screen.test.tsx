/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  type Metrics,
} from 'react-native-safe-area-context';

// `mock`-prefixed so the hoisted factory below may close over them; shared across renders so a
// test can assert on what the deck did.
const mockJoinCommunity = jest.fn<(workspaceId: string) => Promise<void>>();
const mockRequestEnterpriseJoin =
  jest.fn<(workspaceId: string) => Promise<{ status: string | null; isExisting: boolean }>>();
const mockClearPendingAuth = jest.fn();

jest.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({
    joinCommunityAndSwitch: mockJoinCommunity,
    createOrganization: jest.fn(),
    createEnterpriseWorkspace: jest.fn(),
    requestEnterpriseJoin: mockRequestEnterpriseJoin,
    clearPendingAuth: mockClearPendingAuth,
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

    // Two cards on the community path: start, role. Connect-tools is off, so it is not counted.
    expect(screen.getByLabelText('Step 1 of 2')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Join or create workspace'));

    // The workspace branch adds the setup card, so the dots gain one.
    expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy();
    jest.useRealTimers();
  });

  it("asks the dashboard's role question as free text on the community path", async () => {
    jest.useFakeTimers();
    renderDeck();
    act(() => {
      jest.advanceTimersByTime(2500);
    });

    fireEvent.press(screen.getByLabelText(/community space/));
    fireEvent.press(screen.getByLabelText('Next'));

    expect(screen.getByText("What's your role in your team?")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your role'), 'Product Manager');

    mockJoinCommunity.mockResolvedValue(undefined);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Finish'));
    });

    expect(mockJoinCommunity).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  describe('with a personal email address', () => {
    const PERSONAL_CONTEXT: OnboardingContext = {
      ...CONTEXT,
      email: 'devesh@gmail.com',
      publicEmailDomainError:
        'Public email domains (gmail.com) cannot create enterprise workspaces. Please use your work email.',
    };

    it('refuses the workspace option on the start card itself, with the backend message', () => {
      jest.useFakeTimers();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      renderDeck(PERSONAL_CONTEXT);
      act(() => {
        jest.advanceTimersByTime(2500);
      });

      fireEvent.press(screen.getByLabelText('Join or create workspace'));

      expect(alert).toHaveBeenCalledWith(
        'Use your work email',
        PERSONAL_CONTEXT.publicEmailDomainError,
      );
      // Not selected: the deck did not grow and the person cannot be carried on to the setup card.
      expect(screen.getByLabelText('Step 1 of 2')).toBeTruthy();
      alert.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('requesting to join an existing company workspace', () => {
    const COMPANY_CONTEXT: OnboardingContext = {
      ...CONTEXT,
      existingCompany: { orgName: 'Juspay', workspaces: [{ id: 'ws-juspay', name: 'Juspay' }] },
    };

    async function requestToJoin(): Promise<void> {
      jest.useFakeTimers();
      renderDeck(COMPANY_CONTEXT);
      act(() => {
        jest.advanceTimersByTime(2500);
      });

      fireEvent.press(screen.getByLabelText('Join or create workspace'));
      fireEvent.press(screen.getByLabelText('Next'));
      // No role question in between: asking for access ends the deck on the company card.
      fireEvent.press(screen.getByLabelText('Request to join Juspay'));

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Finish'));
      });
    }

    it('asks for access without joining anything', async () => {
      mockRequestEnterpriseJoin.mockResolvedValue({ status: 'PENDING', isExisting: false });

      await requestToJoin();

      expect(mockRequestEnterpriseJoin).toHaveBeenCalledWith('ws-juspay');
      // The bug: this used to be called as well, which created a session and let the person into
      // the app before an admin had approved them.
      expect(mockJoinCommunity).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('ends on a waiting screen that only leads back to sign-in', async () => {
      mockRequestEnterpriseJoin.mockResolvedValue({ status: 'PENDING', isExisting: false });

      await requestToJoin();

      expect(screen.getByText('Request sent')).toBeTruthy();
      // The deck is gone — there is no forward button left to press.
      expect(screen.queryByLabelText('Finish')).toBeNull();

      fireEvent.press(screen.getByLabelText('Back to sign in'));
      expect(mockClearPendingAuth).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('reports a request that was already waiting', async () => {
      mockRequestEnterpriseJoin.mockResolvedValue({ status: 'PENDING', isExisting: true });

      await requestToJoin();

      expect(screen.getByText('Request already sent')).toBeTruthy();
      jest.useRealTimers();
    });
  });
});
