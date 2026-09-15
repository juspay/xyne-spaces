import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionProfile, PROFILE_NAMES } from '../k6/profiles.mjs';

test('defines the five approved workload profiles', () => {
  assert.deepEqual(PROFILE_NAMES, ['smoke', 'release', 'load', 'stress', 'soak']);
});

test('keeps smoke small and release within the pre-production cap', () => {
  assert.deepEqual(buildExecutionProfile('smoke'), {
    executor: 'shared-iterations',
    vus: 1,
    iterations: 1,
    maxDuration: '2m',
  });

  const release = buildExecutionProfile('release');
  assert.equal(Math.max(...release.stages.map(({ target }) => target)), 25);
  assert.equal(release.executor, 'ramping-vus');
});

test('applies VU and steady-duration overrides without changing the scenario', () => {
  assert.deepEqual(buildExecutionProfile('smoke', { vus: 3, duration: '90s' }), {
    executor: 'shared-iterations',
    vus: 3,
    iterations: 3,
    maxDuration: '90s',
  });

  const release = buildExecutionProfile('release', { vus: 40, duration: '12m' });
  assert.equal(Math.max(...release.stages.map(({ target }) => target)), 40);
  assert.equal(release.stages[2].duration, '12m');
});

test('rejects an unknown workload profile', () => {
  assert.throws(() => buildExecutionProfile('maximum'), /unknown profile/i);
});
