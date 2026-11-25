/**
 * The mobile encryption bootstrap: ready only once the `xk` cookie is set, set up again on a
 * new sign-in, and a failed setup retried on a timer with backoff (not without the native key).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

type State = { keyring: object | null; isReady: boolean; error: Error | null; config: null };

class MockModuleMissingError extends Error {}

const mockReset = jest.fn();
let mockState: State;
let mockGeneration = 1;
let mockToken = 'jwt-1';
let mockSetCookie: jest.Mock<(publicKey: string) => Promise<void>>;

jest.mock('@xyne/shared/hooks', () => {
  const { createContext } = require('react') as typeof import('react');
  const Context = createContext<unknown>(null);
  return {
    TestContext: Context,
    EncryptionBootstrapProvider: Context.Provider,
    useEncryptionBootstrapInit: () => ({ ...mockState, reset: mockReset }),
  };
});

jest.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { user_id: 'u1', workspaceId: 'ws1' }, token: mockToken }),
}));
jest.mock('@/src/services/authSessionLifecycle', () => ({
  getAuthSessionGeneration: () => mockGeneration,
}));
jest.mock('@/src/services/encryption/syncProxyKeyCookie', () => ({
  setSyncProxyTransitKey: (publicKey: string) => mockSetCookie(publicKey),
}));
jest.mock('@/src/services/encryption/transitKeyStores', () => ({
  transitKeyStore: {},
  TransitKeyModuleMissingError: MockModuleMissingError,
}));
jest.mock('@/src/services/encryption/transitPlatform', () => ({
  installMobileTransitPlatform: jest.fn(),
}));
jest.mock('@/src/utils/logger', () => ({
  Event: {
    ENCRYPTION_KEY_GENERATED: 'ENCRYPTION_KEY_GENERATED',
    ENCRYPTION_KEY_REGISTRATION_FAILED: 'ENCRYPTION_KEY_REGISTRATION_FAILED',
  },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: () => () => undefined,
}));

type Value = { isReady: boolean; error: Error | null };
let latest: Value | null = null;

function renderProvider(): { rerender: () => void } {
  const { EncryptionBootstrapProvider } =
    require('@/src/providers/EncryptionBootstrapProvider') as typeof import('@/src/providers/EncryptionBootstrapProvider');
  const { TestContext } = require('@xyne/shared/hooks') as {
    TestContext: import('react').Context<unknown>;
  };
  const { useContext } = require('react') as typeof import('react');

  function Probe(): null {
    latest = useContext(TestContext) as Value;
    return null;
  }
  const tree = (): ReactElement => (
    <EncryptionBootstrapProvider>
      <Probe />
    </EncryptionBootstrapProvider>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
}

const KEYRING = { clientPublicKey: 'BPUB' };

beforeEach(() => {
  mockReset.mockReset();
  mockGeneration = 1;
  mockToken = 'jwt-1';
  mockSetCookie = jest.fn(async () => undefined);
  mockState = { keyring: null, isReady: false, error: null, config: null };
  latest = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('EncryptionBootstrapProvider', () => {
  it('is ready only after the xk cookie is set', async () => {
    let setCookie!: () => void;
    mockSetCookie = jest.fn(() => new Promise<void>(resolve => (setCookie = resolve)));
    mockState = { keyring: KEYRING, isReady: true, error: null, config: null };

    renderProvider();
    expect(latest?.isReady).toBe(false);

    await act(async () => setCookie());
    expect(mockSetCookie).toHaveBeenCalledWith('BPUB');
    expect(latest?.isReady).toBe(true);
  });

  it('reports a failed cookie write as a setup error', async () => {
    mockSetCookie = jest.fn(async () => {
      throw new Error('cookie store unavailable');
    });
    mockState = { keyring: KEYRING, isReady: true, error: null, config: null };

    renderProvider();
    await act(async () => undefined);

    expect(latest?.isReady).toBe(false);
    expect(latest?.error?.message).toBe('cookie store unavailable');
  });

  it('sets up again on a new sign-in', () => {
    const view = renderProvider();
    expect(mockReset).not.toHaveBeenCalled();

    mockGeneration = 2;
    mockToken = 'jwt-2';
    view.rerender();

    expect(mockReset).toHaveBeenCalledTimes(1);

    // The registered generation is process-wide: put it back for the next tests.
    mockGeneration = 1;
    mockToken = 'jwt-1';
    view.rerender();
  });

  it('retries a failed setup on a timer, backing off', () => {
    jest.useFakeTimers();
    mockState = { keyring: null, isReady: false, error: new Error('502'), config: null };
    const view = renderProvider();

    act(() => jest.advanceTimersByTime(999));
    expect(mockReset).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(mockReset).toHaveBeenCalledTimes(1);

    // The retry runs and fails again: the next wait is twice as long.
    mockState = { keyring: null, isReady: false, error: null, config: null };
    view.rerender();
    mockState = { keyring: null, isReady: false, error: new Error('502'), config: null };
    view.rerender();

    act(() => jest.advanceTimersByTime(1999));
    expect(mockReset).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1));
    expect(mockReset).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a timer when the native key module is missing', () => {
    jest.useFakeTimers();
    mockState = {
      keyring: null,
      isReady: false,
      error: new MockModuleMissingError(),
      config: null,
    };

    renderProvider();
    act(() => jest.advanceTimersByTime(60_000));

    expect(mockReset).not.toHaveBeenCalled();
  });
});
