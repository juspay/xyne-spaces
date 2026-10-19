import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clearAllAuthCookies, type CookieJar } from '@/src/utils/clearAllAuthCookies';

function createJar(): CookieJar & { calls: Array<{ fn: string; args: unknown[] }> } {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  return {
    calls,
    clearAll: async (...args: unknown[]): Promise<boolean> => {
      calls.push({ fn: 'clearAll', args });
      return true;
    },
  };
}

describe('clearAllAuthCookies', (): void => {
  it('clears the native jar and the WKWebView store on iOS', async (): Promise<void> => {
    const jar = createJar();
    await clearAllAuthCookies(jar, 'ios');
    assert.deepEqual(jar.calls, [
      { fn: 'clearAll', args: [false] },
      { fn: 'clearAll', args: [true] },
    ]);
  });

  it('clears the Android cookie jar once', async (): Promise<void> => {
    const jar = createJar();
    await clearAllAuthCookies(jar, 'android');
    assert.deepEqual(jar.calls, [{ fn: 'clearAll', args: [false] }]);
  });

  it('still clears the WKWebView store when native iOS cleanup fails', async (): Promise<void> => {
    const jar = createJar();
    const nativeError = new Error('native cookie cleanup failed');
    jar.clearAll = async (...args: unknown[]): Promise<boolean> => {
      jar.calls.push({ fn: 'clearAll', args });
      if (args[0] === false) {
        throw nativeError;
      }
      return true;
    };

    await assert.rejects(clearAllAuthCookies(jar, 'ios'), nativeError);
    assert.deepEqual(jar.calls, [
      { fn: 'clearAll', args: [false] },
      { fn: 'clearAll', args: [true] },
    ]);
  });

  it('reports a WKWebView cleanup failure after clearing the native iOS jar', async (): Promise<void> => {
    const jar = createJar();
    const webKitError = new Error('WKWebView cookie cleanup failed');
    jar.clearAll = async (...args: unknown[]): Promise<boolean> => {
      jar.calls.push({ fn: 'clearAll', args });
      if (args[0] === true) {
        throw webKitError;
      }
      return true;
    };

    await assert.rejects(clearAllAuthCookies(jar, 'ios'), webKitError);
    assert.deepEqual(jar.calls, [
      { fn: 'clearAll', args: [false] },
      { fn: 'clearAll', args: [true] },
    ]);
  });

  it('reports an undefined rejection after attempting both iOS stores', async (): Promise<void> => {
    const jar = createJar();
    jar.clearAll = async (...args: unknown[]): Promise<boolean> => {
      jar.calls.push({ fn: 'clearAll', args });
      if (args[0] === false) {
        return Promise.reject(undefined);
      }
      return true;
    };

    let didReject = false;
    try {
      await clearAllAuthCookies(jar, 'ios');
    } catch (error) {
      didReject = true;
      assert.equal(error, undefined);
    }

    assert.equal(didReject, true);
    assert.deepEqual(jar.calls, [
      { fn: 'clearAll', args: [false] },
      { fn: 'clearAll', args: [true] },
    ]);
  });
});
