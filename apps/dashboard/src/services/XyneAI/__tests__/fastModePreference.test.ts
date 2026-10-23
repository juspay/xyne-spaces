import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFastModePreference, writeFastModePreference } from '../fastModePreference';

describe('fast mode preference', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is off until turned on, and is remembered per agent', () => {
    expect(readFastModePreference('pokemon-dex')).toBe(false);
    writeFastModePreference('pokemon-dex', true);
    expect(readFastModePreference('pokemon-dex')).toBe(true);
    expect(readFastModePreference('ask-ai')).toBe(false);
  });

  it('forgets the agent when turned off', () => {
    writeFastModePreference('pokemon-dex', true);
    writeFastModePreference('pokemon-dex', false);
    expect(readFastModePreference('pokemon-dex')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('falls back to off when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => writeFastModePreference('pokemon-dex', true)).not.toThrow();
    expect(readFastModePreference('pokemon-dex')).toBe(false);
  });
});
