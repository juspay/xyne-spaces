// The factory re-executes after every jest.resetModules(); caching the
// mock set on globalThis keeps the module-under-test and this test file
// asserting against the same fns.
jest.mock('@/utils/logger', () => {
  const store = globalThis as Record<string, unknown>;
  if (!store.__encryptionLoggerMock) {
    store.__encryptionLoggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger: store.__encryptionLoggerMock as any,
    stream: { write: jest.fn() },
  };
});

import { logger } from '@/utils/logger';

const LEGACY_HEX = 'a1'.repeat(32);
const K1_HEX = 'b2'.repeat(32);
const K2_HEX = 'c3'.repeat(32);

const VALID_RING = JSON.stringify([
  { id: 'k1', key: K1_HEX },
  { id: 'k2', key: K2_HEX },
]);

type ConfigModule = typeof import('./encryptionKeyRingConfig');

function freshConfig(
  env: { keys?: string; active?: string } = {}
): ReturnType<ConfigModule['loadEncryptionRuntimeConfig']> {
  jest.resetModules();
  delete process.env.ENCRYPTION_KEYS;
  delete process.env.ENCRYPTION_ACTIVE_KEY_ID;

  if (env.keys !== undefined) {
    process.env.ENCRYPTION_KEYS = env.keys;
  }

  if (env.active !== undefined) {
    process.env.ENCRYPTION_ACTIVE_KEY_ID = env.active;
  }

  return require('./encryptionKeyRingConfig').loadEncryptionRuntimeConfig();
}

function loggedLines(): string[] {
  const mockLogger = logger as unknown as {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };

  return [
    ...mockLogger.info.mock.calls,
    ...mockLogger.warn.mock.calls,
    ...mockLogger.error.mock.calls,
    ...mockLogger.debug.mock.calls,
  ].map((args) => args.map(String).join(' '));
}

describe('encryptionKeyRingConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEYS;
    delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
  });

  it('legacy mode when ENCRYPTION_KEYS is missing', () => {
    const config = freshConfig();
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_not_configured');
  });

  it('legacy mode when ENCRYPTION_KEYS is blank', () => {
    const config = freshConfig({ keys: '   ' });
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_not_configured');
  });

  it('legacy mode with sanitized warning for malformed JSON', () => {
    const config = freshConfig({ keys: 'not-json' });
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_json_invalid');
    expect((logger.warn as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('legacy mode when JSON is not a ring', () => {
    expect(freshConfig({ keys: '{}' }).reason).toBe(
      'keyring_validation_failed'
    );
    expect(freshConfig({ keys: '[]' }).reason).toBe(
      'keyring_validation_failed'
    );
    expect(freshConfig({ keys: '{}' }).mode).toBe('legacy');
  });

  it('legacy mode on duplicate IDs', () => {
    const config = freshConfig({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k1', key: K2_HEX },
      ]),
    });
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_validation_failed');
  });

  it('normalizes whitespace around an otherwise valid key', () => {
    const config = freshConfig({
      keys: JSON.stringify([{ id: 'k1', key: ` ${K1_HEX} ` }]),
    });
    expect(config.mode).toBe('keyring-read');
    expect(config.keys.get('k1')).toEqual(
      Buffer.from(K1_HEX, 'hex')
    );
  });

  it('valid ring without an active ID selects keyring-read mode', () => {
    const config = freshConfig({ keys: VALID_RING });
    expect(config.mode).toBe('keyring-read');
    expect(config.reason).toBe('active_key_not_configured');
    expect(config.activeKeyId).toBeNull();
    expect(config.keys.size).toBe(2);
  });

  it('valid ring with an unknown active ID stays in keyring-read mode and warns', () => {
    const config = freshConfig({
      keys: VALID_RING,
      active: 'ghost',
    });
    expect(config.mode).toBe('keyring-read');
    expect(config.reason).toBe('active_key_not_found');
    expect(config.activeKeyId).toBeNull();
    expect(config.keys.size).toBe(2);
    expect((logger.warn as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('valid ring with a matching active ID selects keyring-write mode', () => {
    const config = freshConfig({
      keys: VALID_RING,
      active: 'k2',
    });
    expect(config.mode).toBe('keyring-write');
    expect(config.reason).toBe('keyring_write_enabled');
    expect(config.activeKeyId).toBe('k2');
  });

  it('never logs key material or raw configuration values', () => {
    freshConfig({ keys: `SENTINEL-${LEGACY_HEX}` });
    freshConfig({ keys: VALID_RING, active: 'k1' });

    const lines = loggedLines();

    for (const raw of [K1_HEX, K2_HEX, LEGACY_HEX]) {
      for (const line of lines) {
        expect(line).not.toContain(raw);
      }
    }
  });
});
