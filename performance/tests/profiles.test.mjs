import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionProfile, PROFILE_NAMES } from '../k6/profiles.mjs';

test('defines the approved workload profiles', () => {
  assert.deepEqual(PROFILE_NAMES, ['smoke', 'release', 'load', 'stress', 'spike', 'soak']);
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

test('offers a spike profile alongside the gradual ones', () => {
  assert.ok(PROFILE_NAMES.includes('spike'));
});

test('spike jumps to peak in seconds, which is what separates it from stress', () => {
  const { stages } = buildExecutionProfile('spike');
  const peak = Math.max(...stages.map(({ target }) => target));

  const jump = stages.findIndex(({ target }) => target === peak);
  assert.ok(jump > 0, 'a spike must start from a baseline, not at peak');

  // The defining property: reaching peak takes seconds, not minutes.
  assert.match(stages[jump].duration, /^\d+s$/);
  assert.ok(Number.parseInt(stages[jump].duration, 10) <= 30);

  // And it is a real jump, not a step — at least a fivefold increase.
  assert.ok(peak >= stages[jump - 1].target * 5);
});

test('spike returns to baseline and holds there, so recovery is observable', () => {
  const { stages } = buildExecutionProfile('spike');
  const peak = Math.max(...stages.map(({ target }) => target));
  const lastPeak = stages.map(({ target }) => target).lastIndexOf(peak);

  const after = stages.slice(lastPeak + 1);
  const nonZero = after.filter(({ target }) => target > 0);

  // Two distinct stages: a quick drop back to baseline, then a sustained hold there.
  assert.ok(nonZero.length >= 2, 'a spike must drop back and then hold, not just drop');
  assert.match(nonZero[0].duration, /^\d+s$/, 'the drop back should be quick');

  // The hold is the last non-zero stage, and must be long enough to see queues drain.
  const recovery = nonZero[nonZero.length - 1];
  assert.match(recovery.duration, /^\d+m$/);
  assert.ok(Number.parseInt(recovery.duration, 10) >= 2);
  assert.equal(recovery.target, nonZero[0].target, 'recovery holds at the baseline level');

  // And it must still wind down to zero at the end.
  assert.equal(stages[stages.length - 1].target, 0);
});

test('lengthening a spike run extends recovery, not the surge', () => {
  const base = buildExecutionProfile('spike');
  const longer = buildExecutionProfile('spike', { duration: '10m' });
  const changed = longer.stages.findIndex((s, i) => s.duration !== base.stages[i].duration);
  const peak = Math.max(...base.stages.map(({ target }) => target));

  assert.ok(changed >= 0, 'the duration override must affect some stage');
  assert.notEqual(longer.stages[changed].target, peak,
    'holding the surge for longer would stop it being a spike');
});
