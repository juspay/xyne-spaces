/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
// node --test tools/xyne-automation/scripts/watchdog.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-test-'));
process.env.WATCHDOG_STATE_DIR = stateDir;
process.env.WATCHDOG_CONSECUTIVE = '3';
// biome-ignore lint/style/noRestrictedImports: zero-dep node script — @ aliases need ts-node
const { buildVerdict, collect } = await import('./watchdog.mjs');

const A = 'tests/03_e2e/01_a/01_a.spec::Alpha';
const B = 'tests/03_e2e/02_b/01_b.spec::Bravo';
const C = 'tests/03_e2e/03_c/01_c.spec::Charlie';

const run = (scenarios) =>
  JSON.stringify({
    at: new Date().toISOString(),
    commit: 'abc123',
    totals: {},
    scenarios,
    errors: {},
  });

fs.writeFileSync(
  path.join(stateDir, 'history.jsonl'),
  `${[
    run({ [A]: 'passed', [B]: 'failed', [C]: 'passed' }),
    run({ [A]: 'passed', [B]: 'failed', [C]: 'failed' }),
    run({ [A]: 'failed', [B]: 'failed', [C]: 'passed' }),
    JSON.stringify({ at: new Date().toISOString(), error: 'suite produced no report' }),
    run({ [A]: 'failed', [B]: 'failed', [C]: 'flaky' }),
  ].join('\n')}\n`
);

test('a scenario failing N runs in a row is consistent, and an infra run does not break the streak', () => {
  const v = buildVerdict();
  assert.deepEqual(
    v.consistent.map((i) => i.id),
    [B]
  );
  assert.equal(v.consistent[0].streak, 4);
});

test('a scenario short of the streak is still only confirming', () => {
  const v = buildVerdict();
  assert.deepEqual(
    v.confirming.map((i) => i.id),
    [A]
  );
  assert.equal(v.confirming[0].streak, 2);
});

test('a scenario that alternates is flaky, not consistent', () => {
  const v = buildVerdict();
  assert.deepEqual(
    v.flaky.map((i) => i.id),
    [C]
  );
});

test('skipped runs are not counted as passes that break a streak', () => {
  fs.writeFileSync(
    path.join(stateDir, 'history.jsonl'),
    `${[
      run({ [B]: 'failed' }),
      run({ [B]: 'skipped' }),
      run({ [B]: 'failed' }),
      run({ [B]: 'failed' }),
    ].join('\n')}\n`
  );
  assert.equal(buildVerdict().consistent[0].streak, 3);
});

// Regression: retry-recovery.json identifies scenarios as `<spec>:<line>`. Matching on the
// spec alone marked every scenario in a spec as still failing the moment one sibling did —
// six recovered scenarios got reported as hard failures.
test('recovery is matched per scenario line, not per spec file', () => {
  const spec = 'tests/03_e2e/05_messaging/04_message-actions.spec';
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-run-'));
  fs.mkdirSync(path.join(runDir, 'json-report'));
  fs.writeFileSync(
    path.join(runDir, 'json-report', 'result.json'),
    JSON.stringify({
      specResults: [
        {
          fileName: `/app/${spec}`,
          scenarios: [
            { scenarioHeading: 'Admin edits a channel message', executionStatus: 'failed' },
            { scenarioHeading: 'Admin marks a channel message unread', executionStatus: 'failed' },
          ],
        },
      ],
    })
  );
  fs.writeFileSync(
    path.join(runDir, 'retry-recovery.json'),
    JSON.stringify({ retriedAtEnd: [`${spec}:4`, `${spec}:58`], stillFailing: [`${spec}:58`] })
  );

  const entry = collect(runDir);
  assert.equal(entry.scenarios[`${spec}::Admin edits a channel message`], 'flaky');
  assert.equal(entry.scenarios[`${spec}::Admin marks a channel message unread`], 'failed');
});
