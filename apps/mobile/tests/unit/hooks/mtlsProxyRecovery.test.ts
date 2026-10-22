import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  bumpProxyEpoch,
  getProxyEpoch,
  nextForegroundProbeState,
  subscribeProxyEpoch,
  verifyOrRestartProxy,
  type MtlsProxyHealthNative,
} from '../../../src/hooks/mtlsProxyRecovery';

const API = 'https://app.spaces.xyne.juspay.net/api';

function fakeNative(opts: {
  port: number;
  healthy?: boolean | 'throw';
  restartPort?: number | 'throw';
  withProbe?: boolean;
}): MtlsProxyHealthNative & { calls: string[] } {
  const calls: string[] = [];
  const native: MtlsProxyHealthNative & { calls: string[] } = {
    calls,
    getPort: () => {
      calls.push('getPort');
      return Promise.resolve(opts.port);
    },
  };
  if (opts.withProbe !== false) {
    native.checkHealth = () => {
      calls.push('checkHealth');
      if (opts.healthy === 'throw') return Promise.reject(new Error('probe failed'));
      return Promise.resolve(opts.healthy ?? true);
    };
    native.restart = (base: string) => {
      calls.push(`restart:${base}`);
      if (opts.restartPort === 'throw') return Promise.reject(new Error('bind failed'));
      return Promise.resolve(opts.restartPort ?? 54321);
    };
  }
  return native;
}

describe('verifyOrRestartProxy', () => {
  it('does nothing when the proxy is not running (e.g. after logout)', async () => {
    const native = fakeNative({ port: 0 });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.equal(outcome.action, 'not_running');
    assert.deepEqual(native.calls, ['getPort']);
  });

  it('keeps the current proxy when it answers the health probe', async () => {
    const native = fakeNative({ port: 18080, healthy: true });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.deepEqual(outcome, { action: 'healthy', port: 18080, previousPort: 18080 });
    assert.deepEqual(native.calls, ['getPort', 'checkHealth']);
  });

  it('restarts a proxy that reports a port but does not answer (the incident)', async () => {
    const native = fakeNative({ port: 18080, healthy: false, restartPort: 50123 });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.deepEqual(outcome, { action: 'restarted', port: 50123, previousPort: 18080 });
    assert.deepEqual(native.calls, ['getPort', 'checkHealth', `restart:${API}`]);
  });

  it('treats a throwing probe as unhealthy', async () => {
    const native = fakeNative({ port: 18080, healthy: 'throw' });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.equal(outcome.action, 'restarted');
  });

  it('treats a timed-out probe as unhealthy', async () => {
    const native = fakeNative({ port: 18080, healthy: true });
    const timeout = <T>(promise: Promise<T>, operation: string): Promise<T> =>
      operation === 'Checking proxy health'
        ? Promise.reject(new Error(`${operation} timed out`))
        : promise;
    const outcome = await verifyOrRestartProxy(native, API, timeout);
    assert.equal(outcome.action, 'restarted');
  });

  it('reports a failed restart instead of throwing', async () => {
    const native = fakeNative({ port: 18080, healthy: false, restartPort: 'throw' });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.equal(outcome.action, 'restart_failed');
    assert.equal(outcome.port, 0);
    assert.ok(outcome.error instanceof Error);
  });

  it('reports a restart that returns no port as failed', async () => {
    const native = fakeNative({ port: 18080, healthy: false, restartPort: 0 });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.equal(outcome.action, 'restart_failed');
  });

  it('keeps old behaviour on native builds without the probe (Android, older iOS)', async () => {
    const native = fakeNative({ port: 18080, withProbe: false });
    const outcome = await verifyOrRestartProxy(native, API);
    assert.deepEqual(outcome, { action: 'unsupported', port: 18080, previousPort: 18080 });
    assert.deepEqual(native.calls, ['getPort']);
  });
});

describe('nextForegroundProbeState', () => {
  const run = (states: string[], initial = false): boolean[] => {
    let backgrounded = initial;
    return states.map(state => {
      const next = nextForegroundProbeState(backgrounded, state);
      backgrounded = next.wasBackgrounded;
      return next.probe;
    });
  };

  it('probes on background -> active', () => {
    assert.deepEqual(run(['background', 'active']), [false, true]);
  });

  it('probes on background -> inactive -> active (iOS resume path)', () => {
    assert.deepEqual(run(['inactive', 'background', 'inactive', 'active']), [
      false,
      false,
      false,
      true,
    ]);
  });

  it('does not probe for control centre or notification shade (active -> inactive -> active)', () => {
    assert.deepEqual(run(['inactive', 'active']), [false, false]);
  });

  it('probes only once per resume', () => {
    assert.deepEqual(run(['background', 'active', 'active']), [false, true, false]);
  });
});

describe('proxy epoch', () => {
  it('notifies subscribers and stops after unsubscribe', () => {
    const start = getProxyEpoch();
    let notified = 0;
    const unsubscribe = subscribeProxyEpoch(() => {
      notified += 1;
    });
    assert.equal(bumpProxyEpoch(), start + 1);
    assert.equal(notified, 1);
    unsubscribe();
    bumpProxyEpoch();
    assert.equal(notified, 1);
    assert.equal(getProxyEpoch(), start + 2);
  });

  it('isolates a throwing subscriber', () => {
    let reached = false;
    const a = subscribeProxyEpoch(() => {
      throw new Error('boom');
    });
    const b = subscribeProxyEpoch(() => {
      reached = true;
    });
    bumpProxyEpoch();
    assert.equal(reached, true);
    a();
    b();
  });
});

describe('proxy recovery wiring (source contracts)', () => {
  const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
  const proxyHook = read('src/hooks/useMtlsProxy.ts');
  const videoHook = read('src/hooks/useMtlsVideoStream.ts');
  const swiftServer = read('plugins/ios-modules/MtlsProxyServer.swift');
  const swiftModule = read('plugins/ios-modules/MtlsProxyModule.swift');
  const objcBridge = read('plugins/ios-modules/MtlsProxyModule.m');

  it('only runs the liveness check on iOS', () => {
    assert.match(proxyHook, /if \(Platform\.OS !== 'ios'\) \{\s*return currentPort;/);
  });

  it('re-issues stream URLs when the proxy is replaced', () => {
    assert.match(videoHook, /useSyncExternalStore\(subscribeProxyEpoch, getProxyEpoch/);
    assert.match(videoHook, /\[attachmentId, token, enabled, proxyEpoch\]/);
  });

  it('exposes checkHealth and restart across the native bridge', () => {
    assert.match(objcBridge, /RCT_EXTERN_METHOD\(checkHealth:/);
    assert.match(objcBridge, /RCT_EXTERN_METHOD\(restart:\(NSString \*\)apiBaseUrl/);
    assert.match(swiftModule, /@objc\(checkHealth:reject:\)/);
    assert.match(swiftModule, /@objc\(restart:resolve:reject:\)/);
  });

  it('binds the health probe to the current capability', () => {
    assert.match(swiftServer, /static let healthProbePath = "\/proxy-health"/);
    assert.match(swiftServer, /constantTimeEquals\(probeCapability, session\.capability\)/);
  });

  it('restarts on an ephemeral port and keeps the auth token', () => {
    const restartBody = swiftServer.slice(swiftServer.indexOf('func restart('));
    assert.match(restartBody, /start\(on: 0, allowedBaseURL: allowedBaseURL/);
    assert.doesNotMatch(
      restartBody.slice(0, restartBody.indexOf('/// Build a proxied URL')),
      /authToken = nil/,
    );
  });
});
