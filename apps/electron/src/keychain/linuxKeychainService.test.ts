import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These cover the two failures that produced the Linux re-enrollment loop:
 *  - a missing NSS tool answered "no certificate", so the app re-enrolled a healthy device;
 *  - a pk12util import that failed in every database still reported enrollment success, so the
 *    user got "enrolled" followed by ERR_BAD_SSL_CLIENT_AUTH_CERT on every request.
 */

// Hoisted with the vi.mock factories below, which run before the module-level statements here.
const mockState = vi.hoisted(() => {
  const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');

  const state = {
    /** Absolute tool paths the fake filesystem reports as executable. */
    executableFiles: new Set<string>(),
    /** basename -> handler. Throw from a handler to simulate a failing command. */
    commandHandlers: new Map<string, (args: string[]) => { stdout: string; stderr: string }>(),
  };

  const runCommand = (
    file: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    const handler = state.commandHandlers.get(file.split('/').pop() ?? file);
    if (!handler) {
      return Promise.reject(new Error(`unexpected command: ${file} ${args.join(' ')}`));
    }
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const execFile = Object.assign(
    vi.fn(),
    { [PROMISIFY_CUSTOM]: runCommand },
  );

  return { state, execFile };
});

vi.mock('child_process', () => ({ execFile: mockState.execFile }));

vi.mock('fs', () => {
  const accessSync = (target: string): void => {
    if (!mockState.state.executableFiles.has(target)) {
      throw Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });
    }
  };
  const api = {
    accessSync,
    constants: { X_OK: 1 },
    existsSync: (target: string) => target.includes('.pki'),
    readdirSync: () => [],
    writeFile: (_p: string, _d: string, _o: unknown, cb: (e: null) => void) => cb(null),
    unlink: (_p: string, cb: (e: null) => void) => cb(null),
    mkdir: (_p: string, _o: unknown, cb: (e: null) => void) => cb(null),
  };
  return { ...api, default: api };
});

vi.mock('os', () => {
  const api = { homedir: () => '/home/test', tmpdir: () => '/tmp' };
  return { ...api, default: api };
});

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));
vi.mock('../services/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), logError: vi.fn() },
}));
vi.mock('../services/enrollmentMetrics', () => ({ devicePasswordPopup: { add: vi.fn() } }));
vi.mock('../services/telemetry', () => ({ safeRecordMetric: (fn: () => void) => fn() }));

import { linuxKeychainService } from './linuxKeychainService';
import { KeychainToolingError } from './errors';

const ALL_TOOLS_PRESENT = [
  '/usr/bin/openssl',
  '/usr/bin/certutil',
  '/usr/bin/pk12util',
];

beforeEach(() => {
  mockState.state.executableFiles = new Set(ALL_TOOLS_PRESENT);
  mockState.state.commandHandlers = new Map();
  // Tool lookups are cached per process; clear it so each case sees its own filesystem.
  (linuxKeychainService as unknown as { toolPathCache: Map<string, string | null> })
    .toolPathCache.clear();
});

describe('ensureToolingAvailable', () => {
  it('names every missing tool and how to install them', async () => {
    mockState.state.executableFiles = new Set(['/usr/bin/openssl']);

    await expect(linuxKeychainService.ensureToolingAvailable()).rejects.toThrow(KeychainToolingError);
    await expect(linuxKeychainService.ensureToolingAvailable()).rejects.toThrow(/certutil, pk12util/);
    await expect(linuxKeychainService.ensureToolingAvailable()).rejects.toThrow(/libnss3-tools/);
  });

  it('passes when the tools are only reachable outside PATH', async () => {
    // A desktop launcher can start the app with a PATH that omits the tools' directory.
    mockState.state.executableFiles = new Set([
      '/snap/bin/openssl',
      '/snap/bin/certutil',
      '/snap/bin/pk12util',
    ]);

    await expect(linuxKeychainService.ensureToolingAvailable()).resolves.toBeUndefined();
  });
});

describe('checkIdentity', () => {
  it('throws instead of answering "not enrolled" when certutil is missing', async () => {
    mockState.state.executableFiles = new Set(['/usr/bin/openssl']);

    // Returning false here is what wiped healthy certificates: the caller reads it as
    // "device has no identity" and re-enrolls.
    await expect(linuxKeychainService.checkIdentity('Web Simulation Client'))
      .rejects.toThrow(KeychainToolingError);
  });

  it('throws when the NSS database exists but cannot be read', async () => {
    mockState.state.commandHandlers.set('certutil', () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'certutil: function failed: SEC_ERROR_BAD_DATABASE',
      });
    });

    await expect(linuxKeychainService.checkIdentity('Web Simulation Client'))
      .rejects.toThrow(/Unable to read NSS database/);
  });

  it('reports absent for a database that holds no matching identity', async () => {
    mockState.state.commandHandlers.set('certutil', () => ({ stdout: '', stderr: '' }));
    mockState.state.commandHandlers.set('openssl', () => ({ stdout: '', stderr: '' }));

    await expect(linuxKeychainService.checkIdentity('Web Simulation Client')).resolves.toBe(false);
  });

  it('reports absent for an uninitialised database rather than throwing', async () => {
    mockState.state.commandHandlers.set('certutil', () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'certutil: No certificates found',
      });
    });

    await expect(linuxKeychainService.checkIdentity('Web Simulation Client')).resolves.toBe(false);
  });

  it('finds the identity by nickname', async () => {
    mockState.state.commandHandlers.set('certutil', () => ({
      stdout: 'Certificate Nickname        Trust Attributes\n\nWeb Simulation Client   u,u,u\n',
      stderr: '',
    }));

    await expect(linuxKeychainService.checkIdentity('Web Simulation Client')).resolves.toBe(true);
  });
});

describe('importCertificate', () => {
  const enrol = async (): Promise<void> => {
    mockState.state.commandHandlers.set('openssl', () => ({ stdout: 'KEY', stderr: '' }));
    await linuxKeychainService.generateKeyPair('Web Simulation Client');
  };

  it('fails loudly when the Chromium NSS import fails', async () => {
    await enrol();
    mockState.state.commandHandlers.set('pk12util', () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'pk12util: PKCS12 decode not verified',
      });
    });
    mockState.state.commandHandlers.set('certutil', () => ({ stdout: '', stderr: '' }));

    // Reporting success here is what produced "enrollment complete" screens followed by
    // ERR_BAD_SSL_CLIENT_AUTH_CERT on every dashboard request.
    await expect(linuxKeychainService.importCertificate('CERT')).rejects.toThrow(
      /Certificate Import Failed/,
    );
  });

  it('succeeds when the Chromium import works even if a Firefox profile rejects it', async () => {
    await enrol();
    let call = 0;
    mockState.state.commandHandlers.set('pk12util', () => {
      call += 1;
      if (call === 1) return { stdout: '', stderr: '' };
      throw Object.assign(new Error('Command failed'), { stderr: 'pk12util: locked profile' });
    });
    mockState.state.commandHandlers.set('certutil', () => ({ stdout: '', stderr: '' }));

    await expect(linuxKeychainService.importCertificate('CERT')).resolves.toBeUndefined();
  });
});
