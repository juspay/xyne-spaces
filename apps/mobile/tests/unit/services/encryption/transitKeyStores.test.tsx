/**
 * The native transit key store: rejects within the time limit when the native module is
 * missing (binaries built before it) or stuck, so encryption setup fails instead of hanging.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { LotusTransitKeyModule } from '@/src/modules/transit-key/NativeTransitKeyModule';

let mockModule: LotusTransitKeyModule | undefined;

jest.mock('@/src/modules/transit-key/NativeTransitKeyModule', () => ({
  get LotusTransitKey() {
    return mockModule;
  },
}));

jest.mock('@/src/utils/logger', () => ({
  Event: { ENCRYPTION_KEY_GENERATED: 'ENCRYPTION_KEY_GENERATED' },
  logger: { info: jest.fn(), warn: jest.fn() },
}));

jest.mock('@xyne/shared', () => ({
  toBase64: (value: Uint8Array) => Buffer.from(value).toString('base64'),
  fromBase64: (value: string) => new Uint8Array(Buffer.from(value, 'base64')),
  TransitKeyUnavailableError: class TransitKeyUnavailableError extends Error {
    storage: string;
    constructor(storage: string, reason: string) {
      super(`Transit key unavailable (${storage}): ${reason}`);
      this.storage = storage;
    }
  },
}));

const loadStore = (): typeof import('@/src/services/encryption/transitKeyStores') =>
  require('@/src/services/encryption/transitKeyStores');

beforeEach(() => {
  jest.resetModules();
  mockModule = undefined;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('transitKeyStore', () => {
  it('rejects with TransitKeyModuleMissingError when the module is not in this build', async () => {
    const store = loadStore();
    await expect(store.transitKeyStore.getOrCreate()).rejects.toBeInstanceOf(
      store.TransitKeyModuleMissingError,
    );
  });

  it('rejects when the native key takes longer than the time limit', async () => {
    jest.useFakeTimers();
    mockModule = {
      getPublicKey: () => new Promise(() => undefined),
      deriveSharedSecret: jest.fn<LotusTransitKeyModule['deriveSharedSecret']>(),
    };

    const result = loadStore().transitKeyStore.getOrCreate();
    jest.advanceTimersByTime(6000);

    await expect(result).rejects.toThrow('Native transit key timed out');
  });

  it('returns the native public key and derives through the module', async () => {
    mockModule = {
      getPublicKey: async () => ({ publicKey: 'BPUB', storage: 'tee' }),
      deriveSharedSecret: async () => Buffer.from([1, 2, 3]).toString('base64'),
    };

    const pair = await loadStore().transitKeyStore.getOrCreate();
    const secret = await pair.deriveSharedSecret(new Uint8Array([4, 5]));

    expect(pair.publicKey).toBe('BPUB');
    expect(Array.from(new Uint8Array(secret))).toEqual([1, 2, 3]);
  });
});
