import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDockerInvocation,
  buildRunInput,
  classifyK6ExitCode,
  main,
  parseCliArgs,
  validateRuntime,
} from '../scripts/run.mjs';

const root = '/repo';

test('parses supported CLI arguments', () => {
  assert.deepEqual(
    parseCliArgs([
      '--environment', 'preprod', '--profile', 'release', '--scenario', 'zero-query-transform',
      '--vus', '25', '--duration', '15m', '--dry-run',
    ]),
    {
      environment: 'preprod', profile: 'release', scenario: 'zero-query-transform',
      vusOverride: '25', durationOverride: '15m', dryRun: true,
    },
  );
});

test('rejects unknown CLI arguments and missing values', () => {
  assert.throws(() => parseCliArgs(['--target', 'prod']), /unknown argument/i);
  assert.throws(() => parseCliArgs(['--profile']), /requires a value/i);
});

test('accepts the conventional pnpm argument separator', () => {
  assert.deepEqual(parseCliArgs(['--', '--dry-run']), { dryRun: true });
});

test('uses CI environment parameters while allowing explicit CLI overrides', () => {
  const env = {
    PERF_ENVIRONMENT: 'preprod',
    PERF_PROFILE: 'release',
    PERF_SCENARIO: 'zero-query-transform',
    PERF_VUS_OVERRIDE: '20',
    PERF_DURATION_OVERRIDE: '8m',
  };
  assert.deepEqual(buildRunInput({}, env), {
    environment: 'preprod',
    profile: 'release',
    scenario: 'zero-query-transform',
    vusOverride: '20',
    durationOverride: '8m',
    allowWriteScenarios: false,
  });
  assert.equal(buildRunInput({ profile: 'smoke' }, env).profile, 'smoke');
});

test('classifies k6 threshold failures separately from runner or script failures', () => {
  assert.equal(classifyK6ExitCode(0), 'PASS');
  assert.equal(classifyK6ExitCode(99), 'PRODUCT_FAILURE');
  assert.equal(classifyK6ExitCode(107), 'TEST_FAILURE');
});

test('builds a pinned read-only smoke invocation without revealing secrets', () => {
  const result = buildDockerInvocation(
    { environment: 'sandbox', profile: 'smoke', scenario: 'smoke' },
    {
      root,
      reportDirectory: '/repo/performance/reports/run-1',
      runId: 'run-1',
      releaseVersion: '1.0.0',
      baseUrl: 'https://sandbox.example',
      token: 'super-secret-token',
    },
  );

  assert.equal(result.command, 'docker');
  assert.ok(result.args.includes('grafana/k6:2.2.0'));
  assert.ok(result.args.includes(`${root}:/work:ro`));
  assert.ok(result.args.includes('/work/performance/k6/scenarios/smoke.js'));
  assert.equal(result.safeDisplay.includes('super-secret-token'), false);
  assert.equal(result.args.join(' ').includes('super-secret-token'), false);
  assert.equal(result.env.PERF_TEST_TOKEN, 'super-secret-token');
});

test('passes only environment variable names to Docker for credentials', () => {
  const result = buildDockerInvocation(
    { environment: 'preprod', profile: 'release', scenario: 'messaging' },
    {
      root,
      reportDirectory: '/repo/performance/reports/run-2',
      runId: 'run-2',
      releaseVersion: 'abc123',
      baseUrl: 'https://preprod.example',
      token: 'token-value',
      workspaceId: 'workspace-secret',
      usersFile: '/repo/performance/test-data/users.json',
    },
  );

  const joined = result.args.join(' ');
  assert.match(joined, /--env PERF_BASE_URL/);
  assert.match(joined, /--env PERF_TEST_TOKEN/);
  assert.equal(joined.includes('token-value'), false);
  assert.equal(joined.includes('workspace-secret'), false);
});

test('enables VictoriaMetrics output only when a Remote Write URL is configured', () => {
  const withoutMetrics = buildDockerInvocation(
    { environment: 'sandbox', profile: 'smoke', scenario: 'smoke' },
    {
      root,
      reportDirectory: '/repo/performance/reports/run-3',
      runId: 'run-3',
      releaseVersion: 'abc123',
      baseUrl: 'https://sandbox.example',
    },
  );
  assert.equal(withoutMetrics.args.includes('experimental-prometheus-rw'), false);

  const withMetrics = buildDockerInvocation(
    { environment: 'preprod', profile: 'release', scenario: 'messaging' },
    {
      root,
      reportDirectory: '/repo/performance/reports/run-4',
      runId: 'run-4',
      releaseVersion: 'abc123',
      baseUrl: 'https://preprod.example',
      remoteWriteUrl: 'https://metrics.example/api/v1/write',
      remoteWriteUsername: 'metrics-user',
      remoteWritePassword: 'metrics-secret',
      enforceThresholds: true,
    },
  );
  const joined = withMetrics.args.join(' ');
  assert.match(joined, /-o experimental-prometheus-rw/);
  assert.match(joined, /--env K6_PROMETHEUS_RW_SERVER_URL/);
  assert.match(joined, /--env K6_PROMETHEUS_RW_USERNAME/);
  assert.match(joined, /--env K6_PROMETHEUS_RW_PASSWORD/);
  assert.match(joined, /--env PERF_ENFORCE_THRESHOLDS/);
  assert.equal(joined.includes('metrics-secret'), false);
  assert.equal(withMetrics.env.K6_PROMETHEUS_RW_PASSWORD, 'metrics-secret');
});

test('requires a base URL and keeps report output inside the repository', () => {
  assert.throws(() => validateRuntime({ root, env: {} }), /PERF_BASE_URL/);
  assert.throws(
    () => validateRuntime({ root, env: { PERF_BASE_URL: 'not-a-url' } }),
    /valid http/i,
  );
  assert.throws(
    () => validateRuntime({
      root,
      env: {
        PERF_BASE_URL: 'https://sandbox.example',
        PERF_REMOTE_WRITE_URL: 'https://user:password@metrics.example/api/v1/write',
      },
    }),
    /credentials/i,
  );
});

test('validates messaging fixture existence without reading it into display output', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'xyne-perf-'));
  mkdirSync(path.join(temporaryRoot, 'performance', 'test-data'), { recursive: true });
  const usersFile = path.join(temporaryRoot, 'performance', 'test-data', 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    users: [{
      userId: 'user-1',
      token: 'secret-token',
      workspaceId: 'workspace-1',
      conversationId: 'conversation-1',
    }],
  }));

  assert.equal(
    validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'rest-messaging' },
      env: { PERF_BASE_URL: 'https://preprod.example', PERF_USERS_FILE: usersFile },
    }).usersFile,
    realpathSync(usersFile),
  );
});

test('rejects missing, malformed, empty, and incomplete messaging fixtures', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'xyne-perf-'));
  const fixtureDirectory = path.join(temporaryRoot, 'performance', 'test-data');
  mkdirSync(fixtureDirectory, { recursive: true });

  const runtime = (name) => validateRuntime({
    root: temporaryRoot,
    config: { scenario: 'rest-messaging' },
    env: {
      PERF_BASE_URL: 'https://preprod.example',
      PERF_USERS_FILE: path.join(fixtureDirectory, name),
    },
  });

  assert.throws(() => runtime('missing.json'), /existing file/i);
  writeFileSync(path.join(fixtureDirectory, 'malformed.json'), '{bad json');
  assert.throws(() => runtime('malformed.json'), /valid JSON/i);
  writeFileSync(path.join(fixtureDirectory, 'empty.json'), '{"users":[]}');
  assert.throws(() => runtime('empty.json'), /at least one user/i);
  writeFileSync(path.join(fixtureDirectory, 'incomplete.json'), '{"users":[{"token":"x"}]}');
  assert.throws(() => runtime('incomplete.json'), /userId.*workspaceId.*conversationId/i);
});

test('every supported profile selects an existing scenario entry file', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
  const combinations = [
    ['smoke', 'smoke'],
    ['release', 'zero-query-transform'],
    ['load', 'zero-query-transform'],
    ['stress', 'zero-query-transform'],
    ['soak', 'zero-query-transform'],
    ['release', 'rest-messaging'],
  ];

  for (const [profile, scenario] of combinations) {
    const entry = path.join(repositoryRoot, 'performance', 'k6', 'scenarios', `${scenario}.js`);
    assert.equal(exists(entry), true, `${profile}/${scenario} is missing ${entry}`);
  }
});

function exists(file) {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

test('requires an identity fixture for every authenticated scenario', () => {
  for (const scenario of ['zero-query-transform', 'rest-messaging']) {
    assert.throws(
      () => validateRuntime({
        root,
        config: { scenario, profile: 'release' },
        env: { PERF_BASE_URL: 'https://preprod.example' },
      }),
      /PERF_USERS_FILE is required/,
      scenario,
    );
  }
});

test('smoke needs no identity fixture', () => {
  assert.equal(
    validateRuntime({
      root,
      config: { scenario: 'smoke', profile: 'smoke' },
      env: { PERF_BASE_URL: 'https://sandbox.example' },
    }).usersFile,
    undefined,
  );
});

test('refuses a Zero run whose fixture is too small for the rate limiter', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('one.json', identities(1));

  assert.throws(
    () => validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-query-transform', profile: 'load' },
      env: {
        PERF_BASE_URL: 'https://preprod.example',
        PERF_USERS_FILE: path.join(temporaryRoot, 'performance', 'test-data', 'one.json'),
      },
    }),
    /at least 20 identities/,
  );
});

test('accepts a Zero run once the fixture covers the peak request rate', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('twenty.json', identities(20));

  assert.equal(
    validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-query-transform', profile: 'load' },
      env: {
        PERF_BASE_URL: 'https://preprod.example',
        PERF_USERS_FILE: path.join(temporaryRoot, 'performance', 'test-data', 'twenty.json'),
      },
    }).identityCount,
    20,
  );
});

test('a raised target limit relaxes the identity requirement', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('six.json', identities(6));

  assert.equal(
    validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-query-transform', profile: 'stress' },
      env: {
        PERF_BASE_URL: 'https://preprod.example',
        PERF_USERS_FILE: path.join(temporaryRoot, 'performance', 'test-data', 'six.json'),
        PERF_ZERO_MAX_REQUESTS: '3000',
      },
    }).identityCount,
    6,
  );
});

test('the REST scenario is not held to the Zero identity requirement', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('one.json', identities(1));

  assert.equal(
    validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'rest-messaging', profile: 'load' },
      env: {
        PERF_BASE_URL: 'https://preprod.example',
        PERF_USERS_FILE: path.join(temporaryRoot, 'performance', 'test-data', 'one.json'),
      },
    }).identityCount,
    1,
  );
});

test('forwards the think time so the guard and the script agree', () => {
  const invocation = buildDockerInvocation(
    { environment: 'preprod', profile: 'load', scenario: 'zero-query-transform' },
    {
      root: '/repo',
      reportDirectory: '/repo/performance/reports/run',
      runId: 'run',
      baseUrl: 'https://preprod.example',
      releaseVersion: 'abc123',
      thinkTimeSeconds: 4,
    },
  );

  assert.ok(invocation.args.includes('PERF_THINK_TIME_SECONDS'));
  assert.equal(invocation.env.PERF_THINK_TIME_SECONDS, '4');
});

function fixtureWorkspace() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'xyne-perf-'));
  const directory = path.join(temporaryRoot, 'performance', 'test-data');
  mkdirSync(directory, { recursive: true });
  return {
    temporaryRoot,
    write: (name, payload) =>
      writeFileSync(path.join(directory, name), JSON.stringify(payload)),
  };
}

function identities(count) {
  return {
    users: Array.from({ length: count }, (_unused, index) => ({
      userId: `user-${index}`,
      token: `token-${index}`,
      workspaceId: 'workspace-1',
      conversationId: `conversation-${index}`,
    })),
  };
}

test('a dry run leaves no report directory behind', () => {
  const reports = path.resolve(import.meta.dirname, '..', 'reports');
  const before = new Set(readdirSync(reports));

  assert.equal(main(['--dry-run'], { PERF_BASE_URL: 'https://sandbox.example' }), 0);

  assert.deepEqual(readdirSync(reports).filter((entry) => !before.has(entry)), []);
});

test('the write opt-in reaches the catalog from the environment', () => {
  assert.deepEqual(
    buildRunInput({ scenario: 'rest-messaging' }, { PERF_ALLOW_WRITE_SCENARIOS: 'true' })
      .allowWriteScenarios,
    true,
  );
  assert.equal(buildRunInput({}, {}).allowWriteScenarios, false);
});
