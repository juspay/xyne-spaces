/**
 * Global setup for L2 rendering tests (jest-expo + React Native Testing Library).
 *
 * React Native Testing Library v13 registers its jest matchers automatically,
 * so no `extend-expect` import is required here. Add shared native-module mocks
 * and global test hooks in this file as the rendering suite grows.
 */

import { jest } from '@jest/globals';

/**
 * `react-native-mmkv` is a Nitro module and throws on import outside a real
 * app binary. It is reached transitively by anything that renders an
 * interactive component: component → `utils/haptics` → `settingsMachine` →
 * `settingsStorage` → `services/localStorage` → MMKV.
 *
 * An in-memory store keeps that chain working, so settings resolve to their
 * schema defaults (haptics on) and render tests do not each need their own
 * mock.
 */
jest.mock('react-native-mmkv', () => {
  class InMemoryMMKV {
    private store = new Map<string, string | number | boolean>();

    set(key: string, value: string | number | boolean): void {
      this.store.set(key, value);
    }

    getString(key: string): string | undefined {
      const value = this.store.get(key);
      return typeof value === 'string' ? value : undefined;
    }

    getBoolean(key: string): boolean | undefined {
      const value = this.store.get(key);
      return typeof value === 'boolean' ? value : undefined;
    }

    getNumber(key: string): number | undefined {
      const value = this.store.get(key);
      return typeof value === 'number' ? value : undefined;
    }

    contains(key: string): boolean {
      return this.store.has(key);
    }

    remove(key: string): void {
      this.store.delete(key);
    }

    clearAll(): void {
      this.store.clear();
    }

    getAllKeys(): string[] {
      return [...this.store.keys()];
    }
  }

  return {
    MMKV: InMemoryMMKV,
    createMMKV: (): InMemoryMMKV => new InMemoryMMKV(),
  };
});

/**
 * `react-native-device-info` constructs a NativeEventEmitter at import time,
 * which throws off-device. It is reached transitively by anything that touches
 * the API client: component → `services/apiClient` → `MtlsApiService` →
 * `utils/mtlsHttpClient` → device-info. Static test values keep that chain
 * importable.
 */
jest.mock('react-native-device-info', () => {
  // Every DeviceInfo getter returns a string (await-ing a plain string works
  // for the async variants), so a Proxy covers the whole surface without
  // enumerating methods.
  const getter = (): string => 'test-device';
  const proxy = new Proxy(
    {},
    { get: (_target, prop) => (prop === '__esModule' ? undefined : getter) },
  );
  return { __esModule: true, default: proxy };
});

/**
 * `@react-native-cookies/cookies` throws at import off-device (missing native
 * module) — same API-client chain as device-info above, via
 * `utils/apiCookieHeader`.
 */
jest.mock('@react-native-cookies/cookies', () => ({
  __esModule: true,
  default: {
    get: async (): Promise<Record<string, never>> => ({}),
    getAll: async (): Promise<Record<string, never>> => ({}),
    set: async (): Promise<boolean> => true,
    clearAll: async (): Promise<boolean> => true,
    clearByName: async (): Promise<boolean> => true,
    flush: async (): Promise<void> => {},
  },
}));

/**
 * AsyncStorage's native module is absent under jest; the package ships an
 * official in-memory mock for exactly this. Reached via the same chain
 * (`utils/logger` inside `utils/mtlsHttpClient`).
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

export {};
