import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENVIRONMENTS,
  K6_IMAGE,
  resolveRunConfig,
} from '../config/catalog.mjs';

test('defaults to a safe sandbox smoke execution', () => {
  assert.deepEqual(resolveRunConfig({}), {
    environment: 'sandbox',
    profile: 'smoke',
    scenario: 'smoke',
    vusOverride: undefined,
    durationOverride: undefined,
  });
});

test('uses messaging as the default scenario for non-smoke profiles', () => {
  assert.equal(resolveRunConfig({ profile: 'release' }).scenario, 'messaging');
});

test('pins the k6 image and defines environment caps', () => {
  assert.equal(K6_IMAGE, 'grafana/k6:2.2.0');
  assert.deepEqual(ENVIRONMENTS.sandbox, { maxVus: 50, maxDurationSeconds: 3600 });
  assert.deepEqual(ENVIRONMENTS.preprod, { maxVus: 500, maxDurationSeconds: 28800 });
});

test('rejects production and unknown environments', () => {
  assert.throws(() => resolveRunConfig({ environment: 'production' }), /not allowed/i);
  assert.throws(() => resolveRunConfig({ environment: 'local' }), /not allowed/i);
});

test('rejects unknown profiles and scenarios', () => {
  assert.throws(() => resolveRunConfig({ profile: 'maximum' }), /unknown profile/i);
  assert.throws(() => resolveRunConfig({ scenario: 'attachments' }), /unknown scenario/i);
});

test('accepts bounded VU and duration overrides', () => {
  assert.deepEqual(
    resolveRunConfig({
      environment: 'preprod',
      profile: 'load',
      scenario: 'messaging',
      vusOverride: '250',
      durationOverride: '45m',
    }),
    {
      environment: 'preprod',
      profile: 'load',
      scenario: 'messaging',
      vusOverride: 250,
      durationOverride: '45m',
    },
  );
});

test('rejects invalid VU overrides', () => {
  for (const value of ['0', '-1', '1.5', 'abc']) {
    assert.throws(() => resolveRunConfig({ vusOverride: value }), /positive integer/i);
  }
});

test('rejects a VU override above the environment cap', () => {
  assert.throws(
    () => resolveRunConfig({ environment: 'preprod', vusOverride: '501' }),
    /maximum 500/i,
  );
});

test('rejects invalid or excessive duration overrides', () => {
  for (const value of ['0s', '-2m', '1.5m', 'forever', '10d']) {
    assert.throws(() => resolveRunConfig({ durationOverride: value }), /duration/i);
  }
  assert.throws(
    () => resolveRunConfig({ environment: 'sandbox', durationOverride: '61m' }),
    /maximum 1h/i,
  );
});
