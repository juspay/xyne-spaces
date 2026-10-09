import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCTION_HOSTS,
  assertNotProductionHost,
  routeEnvHeaders,
} from '../k6/env-routing.mjs';

test('names the production hosts that must never receive load', () => {
  // apps/electron/src/app/config.ts:65-70
  assert.deepEqual(PRODUCTION_HOSTS, ['app.spaces.xyne.juspay.net', 'auth.spaces.xyne.juspay.net']);
});

test('pre-prod is the production host plus a routing header, so it must be sent', () => {
  // apps/electron/src/services/request-interceptor.ts:129-131
  assert.deepEqual(routeEnvHeaders('preprod'), { 'x-route-env': 'playground' });
});

test('sandbox is a separate deployment and takes no routing header', () => {
  assert.deepEqual(routeEnvHeaders('sandbox'), {});
  assert.deepEqual(routeEnvHeaders(undefined), {});
});

test('refuses a production host for any environment other than preprod', () => {
  // The environment name is a label; the hostname is where traffic actually lands.
  for (const url of [
    'https://app.spaces.xyne.juspay.net',
    'https://app.spaces.xyne.juspay.net/api',
    'https://AUTH.SPACES.XYNE.JUSPAY.NET',
    'http://app.spaces.xyne.juspay.net:8080/x',
  ]) {
    assert.throws(() => assertNotProductionHost(url), /production/i, url);
    assert.throws(() => assertNotProductionHost(url, 'sandbox'), /production/i, url);
  }
});

test('accepts the production host for preprod, which has no host of its own', () => {
  // Pre-production is this host plus x-route-env; the catalog limits it to smoke and release.
  assert.doesNotThrow(() => assertNotProductionHost('https://app.spaces.xyne.juspay.net', 'preprod'));
});

test('allows sandbox and anything that is not a known production host', () => {
  assert.doesNotThrow(() => assertNotProductionHost('https://spaces.sandbox.xyne.juspay.net'));
  assert.doesNotThrow(() => assertNotProductionHost('http://host.docker.internal:3001'));
  assert.doesNotThrow(() => assertNotProductionHost('https://preprod.example.com'));
});

test('a lookalike host does not slip past the check', () => {
  // Substring matching would wave through an attacker- or typo-shaped host.
  assert.doesNotThrow(() => assertNotProductionHost('https://app.spaces.xyne.juspay.net.evil.com'));
  assert.throws(() => assertNotProductionHost('https://app.spaces.xyne.juspay.net/'), /production/i);
});
