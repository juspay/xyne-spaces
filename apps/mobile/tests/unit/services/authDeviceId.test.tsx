/**
 * authDeviceId with a stubbed SecureStore and the in-memory MMKV from jest.setup: the
 * device-only id, restore detection from the backed-up copy, and an unreadable store.
 * Each test loads fresh modules, so the cached identity and MMKV start empty.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AuthDeviceId = typeof import('@/src/services/authDeviceId');
type LocalStorage = typeof import('@/src/services/localStorage');

const DEVICE_ID_KEY = 'lotus_auth_device_id_v1';
const BACKED_UP_DEVICE_ID_KEY = '@lotus/auth_device_id_backed_up';

const mockSecureStore = {
  getItemAsync: jest.fn<(key: string, options?: unknown) => Promise<string | null>>(),
  setItemAsync: jest.fn<(key: string, value: string, options?: unknown) => Promise<void>>(),
};

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: (...args: [string, unknown?]) => mockSecureStore.getItemAsync(...args),
  setItemAsync: (...args: [string, string, unknown?]) => mockSecureStore.setItemAsync(...args),
}));

let deviceId: AuthDeviceId;
let storage: LocalStorage;
let stored: Map<string, string>;

beforeEach(() => {
  jest.resetModules();
  stored = new Map();
  mockSecureStore.getItemAsync.mockReset().mockImplementation(async key => stored.get(key) ?? null);
  mockSecureStore.setItemAsync.mockReset().mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  deviceId = require('@/src/services/authDeviceId');
  storage = require('@/src/services/localStorage');
});

describe('authDeviceId', () => {
  it('creates and keeps an id on a fresh install', async () => {
    const id = await deviceId.getAuthDeviceId();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.get(DEVICE_ID_KEY)).toBe(id);
    expect(storage.getString(BACKED_UP_DEVICE_ID_KEY)).toBe(id);
    expect(await deviceId.isRestoredFromAnotherInstall()).toBe(false);
    expect(await deviceId.getAuthDeviceId()).toBe(id);
  });

  it('uses the stored id and restores its backed-up copy', async () => {
    stored.set(DEVICE_ID_KEY, 'stored-id');

    expect(await deviceId.getAuthDeviceId()).toBe('stored-id');
    expect(storage.getString(BACKED_UP_DEVICE_ID_KEY)).toBe('stored-id');
    expect(await deviceId.isRestoredFromAnotherInstall()).toBe(false);
    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('reports a restore when only the backed-up copy came along, and never reuses it', async () => {
    storage.setString(BACKED_UP_DEVICE_ID_KEY, 'other-phone-id');

    const id = await deviceId.getAuthDeviceId();
    expect(id).not.toBe('other-phone-id');
    expect(await deviceId.isRestoredFromAnotherInstall()).toBe(true);
    expect(stored.get(DEVICE_ID_KEY)).toBe(id);
    expect(storage.getString(BACKED_UP_DEVICE_ID_KEY)).toBe(id);
  });

  it('gives concurrent first callers the same id', async () => {
    const ids = await Promise.all([
      deviceId.getAuthDeviceId(),
      deviceId.getAuthDeviceId(),
      deviceId.getAuthDeviceId(),
    ]);

    expect(new Set(ids).size).toBe(1);
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('retries a read that fails for a moment', async () => {
    stored.set(DEVICE_ID_KEY, 'stored-id');
    mockSecureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore busy'));

    expect(await deviceId.getAuthDeviceId()).toBe('stored-id');
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledTimes(2);
    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('uses a throwaway id while the store stays unreadable, and tries again next call', async () => {
    stored.set(DEVICE_ID_KEY, 'stored-id');
    storage.setString(BACKED_UP_DEVICE_ID_KEY, 'stored-id');
    mockSecureStore.getItemAsync.mockRejectedValue(new Error('locked'));

    const throwaway = await deviceId.getAuthDeviceId();
    expect(throwaway).not.toBe('stored-id');
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledTimes(3);
    // Unreadable is not missing: nothing persisted, no restore, backed-up copy untouched.
    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(await deviceId.isRestoredFromAnotherInstall()).toBe(false);
    expect(storage.getString(BACKED_UP_DEVICE_ID_KEY)).toBe('stored-id');

    mockSecureStore.getItemAsync.mockImplementation(async key => stored.get(key) ?? null);
    expect(await deviceId.getAuthDeviceId()).toBe('stored-id');
  });

  it('still returns an id when it cannot be stored', async () => {
    mockSecureStore.setItemAsync.mockRejectedValue(new Error('disk full'));

    const id = await deviceId.getAuthDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await deviceId.isRestoredFromAnotherInstall()).toBe(false);
  });
});
