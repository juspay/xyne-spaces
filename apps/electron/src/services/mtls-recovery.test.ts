import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();

/** Swapped per test so the recovery path can be pointed at a main window, or at none. */
const mainWindowMock = vi.hoisted(() => ({
  main: null as unknown,
  allWindows: [] as unknown[],
}));

const makeWindow = (name: string) => ({
  name,
  isDestroyed: () => false,
  isVisible: () => true,
  show: vi.fn(),
  focus: vi.fn(),
  loadURL: vi.fn().mockResolvedValue(undefined),
  webContents: { stop: vi.fn() },
});

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('electron', () => ({
  app: { on: vi.fn(), once: vi.fn(), getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => mainWindowMock.allWindows },
}));
vi.mock('../window/manager', () => ({ getMainWindow: () => mainWindowMock.main }));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string): unknown {
      return storeData.get(key);
    }
    set(key: string, value: unknown): void {
      storeData.set(key, value);
    }
    delete(key: string): void {
      storeData.delete(key);
    }
  },
}));
vi.mock('./logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), logError: vi.fn() },
}));
vi.mock('../keychain', () => ({ keychain: { deleteIdentity: vi.fn() } }));
vi.mock('../app/config', () => ({
  config: {
    enableMtls: true,
    MTLS_IDENTITY_NAME: 'Test Client',
    MTLS_FRONTEND_URL: 'https://auth.example.test',
  },
}));

import {
  isClientAuthFailure,
  recoverFromDeadCertificate,
  reportClientAuthFailure,
  resetRecoveryStateForTests,
} from './mtls-recovery';

const REASON_KEY = 'mtls.enrollmentReason';

describe('isClientAuthFailure', () => {
  it('matches the client-auth TLS errors that mean our certificate was rejected', () => {
    expect(isClientAuthFailure('net::ERR_BAD_SSL_CLIENT_AUTH_CERT')).toBe(true);
    expect(isClientAuthFailure('ERR_SSL_CLIENT_AUTH_SIGNATURE_FAILED')).toBe(true);
    expect(isClientAuthFailure('ERR_SSL_CLIENT_AUTH_CERT_NEEDED')).toBe(true);
    expect(isClientAuthFailure('ERR_SSL_CLIENT_AUTH_NO_COMMON_ALGORITHMS')).toBe(true);
  });

  it('ignores server-trust and transport errors, which deleting our identity would not fix', () => {
    expect(isClientAuthFailure('net::ERR_CERT_AUTHORITY_INVALID')).toBe(false);
    expect(isClientAuthFailure('net::ERR_CERT_DATE_INVALID')).toBe(false);
    expect(isClientAuthFailure('net::ERR_CONNECTION_REFUSED')).toBe(false);
    expect(isClientAuthFailure('net::ERR_INTERNET_DISCONNECTED')).toBe(false);
    expect(isClientAuthFailure(undefined)).toBe(false);
    expect(isClientAuthFailure('')).toBe(false);
  });
});

describe('failure threshold', () => {
  beforeEach(() => {
    resetRecoveryStateForTests();
    storeData.clear();
    mainWindowMock.main = makeWindow('main');
  });

  it('leaves a healthy certificate alone until the threshold is reached', () => {
    reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });
    reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });

    expect(storeData.get(REASON_KEY)).toBeUndefined();
  });

  it('recovers on the third failure inside the window', () => {
    reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });
    reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });
    reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });

    expect(storeData.get(REASON_KEY)).toMatchObject({
      reason: 'certificate_rejected',
      detail: 'ERR_BAD_SSL_CLIENT_AUTH_CERT',
    });
  });

  it('forgets failures older than the window so blips never accumulate', () => {
    vi.useFakeTimers();
    try {
      reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });
      reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });

      vi.advanceTimersByTime(61_000);

      reportClientAuthFailure({ errorCode: 'ERR_BAD_SSL_CLIENT_AUTH_CERT' });
      expect(storeData.get(REASON_KEY)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('recovery', () => {
  beforeEach(() => {
    resetRecoveryStateForTests();
    storeData.clear();
    mainWindowMock.main = null;
    mainWindowMock.allWindows = [];
  });

  it('always reports the certificate as rejected, since that is all the TLS error tells us', async () => {
    mainWindowMock.main = makeWindow('main');

    await recoverFromDeadCertificate({ detail: 'ERR_BAD_SSL_CLIENT_AUTH_CERT', trigger: 'test' });

    expect(storeData.get(REASON_KEY)).toMatchObject({ reason: 'certificate_rejected' });
  });

  it('navigates the main window, never another app window', async () => {
    const pill = makeWindow('recording-pill');
    const main = makeWindow('main');
    // Order matters: the pill comes first, which is what the old getAllWindows() pick returned.
    mainWindowMock.allWindows = [pill, main];
    mainWindowMock.main = main;

    await recoverFromDeadCertificate({ trigger: 'test' });

    expect(main.loadURL).toHaveBeenCalledWith('https://auth.example.test');
    expect(pill.loadURL).not.toHaveBeenCalled();
    expect(pill.show).not.toHaveBeenCalled();
    expect(pill.focus).not.toHaveBeenCalled();
  });

  it('touches nothing when the app is in the tray with no main window', async () => {
    const pill = makeWindow('recording-pill');
    mainWindowMock.allWindows = [pill];
    mainWindowMock.main = null;

    await recoverFromDeadCertificate({ trigger: 'test' });

    expect(pill.loadURL).not.toHaveBeenCalled();
    // The reason is still recorded, so the next launch opens on enrollment and explains itself.
    expect(storeData.get(REASON_KEY)).toMatchObject({ reason: 'certificate_rejected' });
  });

  it('ignores a second trigger while a recovery is in flight', async () => {
    const main = makeWindow('main');
    mainWindowMock.main = main;

    await Promise.all([
      recoverFromDeadCertificate({ trigger: 'first' }),
      recoverFromDeadCertificate({ trigger: 'second' }),
    ]);

    expect(main.loadURL).toHaveBeenCalledTimes(1);
  });
});
