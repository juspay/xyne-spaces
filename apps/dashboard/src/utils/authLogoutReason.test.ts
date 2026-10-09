import { beforeEach, describe, expect, it, vi } from 'vitest';

// The dashboard unit suite runs in the node environment, so the browser storage this module
// uses is stubbed rather than pulling in a DOM.
class FakeStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const fakeSessionStorage = new FakeStorage();
vi.stubGlobal('sessionStorage', fakeSessionStorage);

import { AuthLogoutReason, setAuthLogoutReason, takeAuthLogoutMessage } from './authLogoutReason';

describe('authLogoutReason', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fakeSessionStorage.clear();
  });

  it('returns nothing when the user simply opened the login screen', () => {
    expect(takeAuthLogoutMessage()).toBeNull();
  });

  it('explains an expired session once, then stops', () => {
    setAuthLogoutReason(AuthLogoutReason.SESSION_EXPIRED);

    expect(takeAuthLogoutMessage()).toMatch(/session expired/i);
    // Consumed on read: reloading the login screen must not keep repeating it.
    expect(takeAuthLogoutMessage()).toBeNull();
  });

  it('ignores an unrecognised stored reason instead of showing a raw code', () => {
    fakeSessionStorage.setItem('auth_logout_reason', 'something_new');

    expect(takeAuthLogoutMessage()).toBeNull();
  });

  it('never breaks the sign-out when storage is unavailable', () => {
    vi.spyOn(fakeSessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(fakeSessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => setAuthLogoutReason(AuthLogoutReason.SESSION_EXPIRED)).not.toThrow();
    expect(takeAuthLogoutMessage()).toBeNull();
  });
});
