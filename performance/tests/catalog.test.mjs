import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENVIRONMENTS,
  K6_IMAGE,
  resolveRunConfig,
  PROFILES,
  SCENARIOS,
  WRITE_SCENARIOS,
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

test('defaults non-smoke profiles to the Zero query-transform read path', () => {
  assert.equal(resolveRunConfig({ profile: 'release' }).scenario, 'zero-query-transform');
});

test('offers the Zero and REST scenarios under explicit names', () => {
  assert.deepEqual(
    [...SCENARIOS].sort(),
    ['attachments', 'rest-messaging', 'search', 'smoke', 'zero-push', 'zero-query-transform'],
  );
});

test('no longer accepts the ambiguous messaging scenario name', () => {
  assert.throws(
    () => resolveRunConfig({ profile: 'release', scenario: 'messaging' }),
    /unknown scenario/i,
  );
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

test('allows only short profiles in sandbox', () => {
  assert.doesNotThrow(() => resolveRunConfig({ environment: 'sandbox', profile: 'release' }));
  for (const profile of ['load', 'stress', 'soak']) {
    assert.throws(
      () => resolveRunConfig({ environment: 'sandbox', profile }),
      /preprod/i,
    );
  }
});

test('rejects unknown profiles and scenarios', () => {
  assert.throws(() => resolveRunConfig({ profile: 'maximum' }), /unknown profile/i);
  assert.throws(() => resolveRunConfig({ scenario: 'not-a-scenario' }), /unknown scenario/i);
});

test('accepts bounded VU and duration overrides', () => {
  assert.deepEqual(
    resolveRunConfig({
      environment: 'preprod',
      profile: 'load',
      scenario: 'zero-query-transform',
      vusOverride: '250',
      durationOverride: '45m',
    }),
    {
      environment: 'preprod',
      profile: 'load',
      scenario: 'zero-query-transform',
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

test('names the scenarios that write rows', () => {
  assert.deepEqual([...WRITE_SCENARIOS].sort(), ['rest-messaging', 'zero-push']);
});

test('zero-push is gated, because it inserts a message per iteration', () => {
  assert.throws(
    () => resolveRunConfig({ profile: 'release', scenario: 'zero-push' }),
    /writes rows and no reset is implemented/i,
  );
  assert.equal(
    resolveRunConfig({ profile: 'release', scenario: 'zero-push', allowWriteScenarios: true })
      .scenario,
    'zero-push',
  );
});

test('refuses a write scenario while no fixture reset exists', () => {
  assert.throws(
    () => resolveRunConfig({ profile: 'release', scenario: 'rest-messaging' }),
    /writes rows and no reset is implemented/i,
  );
});

test('allows a write scenario only on an explicit opt-in', () => {
  assert.equal(
    resolveRunConfig({
      profile: 'release',
      scenario: 'rest-messaging',
      allowWriteScenarios: true,
    }).scenario,
    'rest-messaging',
  );
});

test('the read scenarios need no opt-in', () => {
  assert.equal(resolveRunConfig({ profile: 'release' }).scenario, 'zero-query-transform');
  assert.equal(resolveRunConfig({ profile: 'smoke' }).scenario, 'smoke');
});

test('search is a read scenario, so it carries no write gate', () => {
  assert.equal(
    resolveRunConfig({ profile: 'release', scenario: 'search' }).scenario,
    'search',
  );
});

test('the runner and the k6 profiles agree on which profiles exist', async () => {
  // These are two separate lists: catalog.mjs gates what the runner accepts, profiles.mjs
  // defines what k6 executes. A profile added to one and not the other is either rejected
  // before it runs or accepted and then unbuildable, so they must be kept in lockstep.
  const { PROFILE_NAMES } = await import('../k6/profiles.mjs');
  assert.deepEqual([...PROFILES].sort(), [...PROFILE_NAMES].sort());
});

test('every accepted profile is actually buildable by k6', async () => {
  const { buildExecutionProfile } = await import('../k6/profiles.mjs');
  for (const profile of PROFILES) {
    assert.doesNotThrow(() => buildExecutionProfile(profile), profile);
  }
});

test('no profile default exceeds the cap of an environment that allows it', async () => {
  const { buildExecutionProfile, peakVus } = await import('../k6/profiles.mjs');
  for (const [environment, limits] of Object.entries(ENVIRONMENTS)) {
    for (const profile of PROFILES) {
      let allowed = true;
      try { resolveRunConfig({ environment, profile }); } catch { allowed = false; }
      if (!allowed) continue;
      const peak = peakVus(buildExecutionProfile(profile));
      assert.ok(peak <= limits.maxVus, `${profile} peaks at ${peak} on ${environment}`);
    }
  }
});
