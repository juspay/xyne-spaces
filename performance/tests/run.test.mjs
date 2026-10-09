import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDockerInvocation,
  buildRunInput,
  classifyK6ExitCode,
  processExitCodeFor,
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
      remoteWriteUrl: 'https://metrics.example/api/v1/write',
      remoteWritePassword: 'super-secret-password',
    },
  );

  assert.equal(result.command, 'docker');
  assert.ok(result.args.includes('grafana/k6:2.2.0'));
  assert.ok(result.args.includes(`${root}:/work:ro`));
  assert.ok(result.args.includes('/work/performance/k6/scenarios/smoke.js'));
  assert.equal(result.safeDisplay.includes('super-secret-password'), false);
  assert.equal(result.args.join(' ').includes('super-secret-password'), false);
  assert.equal(result.env.K6_PROMETHEUS_RW_PASSWORD, 'super-secret-password');
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
      remoteWriteUrl: 'https://metrics.example/api/v1/write',
      remoteWritePassword: 'password-value',
      usersFile: '/repo/performance/test-data/users.json',
    },
  );

  const joined = result.args.join(' ');
  assert.match(joined, /--env PERF_BASE_URL/);
  assert.match(joined, /--env K6_PROMETHEUS_RW_PASSWORD/);
  assert.equal(joined.includes('password-value'), false);
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
      config: { scenario: 'smoke' },
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

test('refuses an attachments fixture where any identity lacks attachmentIds', () => {
  // Identities are assigned round-robin, so one without ids leaves its virtual users idle.
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'xyne-perf-'));
  const usersFile = path.join(temporaryRoot, 'users.json');
  const user = (index, attachmentIds) => ({
    userId: `user-${index}`,
    token: `token-${index}`,
    workspaceId: 'workspace-1',
    conversationId: 'conversation-1',
    ...(attachmentIds ? { attachmentIds } : {}),
  });
  const runtime = () => validateRuntime({
    root: temporaryRoot,
    config: { scenario: 'attachments', profile: 'release' },
    env: { PERF_BASE_URL: 'https://sandbox.example', PERF_USERS_FILE: usersFile },
  });

  writeFileSync(usersFile, JSON.stringify({ users: [user(1, ['a-1']), user(2)] }));
  assert.throws(runtime, /user 1 requires attachmentIds/);

  writeFileSync(usersFile, JSON.stringify({ users: [user(1, ['a-1']), user(2, ['a-2'])] }));
  assert.doesNotThrow(runtime);
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
    ['release', 'search'],
    ['release', 'attachments'],
    ['release', 'zero-push'],
  ];

  for (const [profile, scenario] of combinations) {
    const entry = path.join(repositoryRoot, 'performance', 'k6', 'scenarios', `${scenario}.js`);
    assert.equal(existsSync(entry), true, `${profile}/${scenario} is missing ${entry}`);
  }
});

test('requires an identity fixture for every authenticated scenario', () => {
  for (const scenario of ['zero-query-transform', 'zero-push', 'rest-messaging', 'search', 'attachments']) {
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

test('search needs a fixture but not the Zero identity floor', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('one.json', identities(1));

  // /api/vespaSearch goes through authMiddleware.authenticate, not the Zero rate
  // limiter, so one identity is legal even at the load profile.
  assert.equal(
    validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'search', profile: 'load' },
      env: {
        PERF_BASE_URL: 'https://preprod.example',
        PERF_USERS_FILE: path.join(temporaryRoot, 'performance', 'test-data', 'one.json'),
      },
    }).identityCount,
    1,
  );
});

test('zero-push carries the Zero identity floor, because push is rate limited too', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('one.json', identities(1));

  // handleMutate calls checkRateLimit("mutate", sub, batchSize), so the same per-user
  // budget applies as for queries.
  assert.throws(
    () => validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-push', profile: 'load' },
      env: {
        PERF_BASE_URL: 'https://preprod.example',
        PERF_USERS_FILE: path.join(temporaryRoot, 'performance', 'test-data', 'one.json'),
      },
    }),
    /at least 20 identities/,
  );
});

test('forwards the Zero push parameters from runtime, not the ambient environment', () => {
  const invocation = buildDockerInvocation(
    { environment: 'preprod', profile: 'release', scenario: 'zero-push' },
    {
      root: '/repo', reportDirectory: '/repo/performance/reports/r', runId: 'r',
      baseUrl: 'https://preprod.example', releaseVersion: 'abc', thinkTimeSeconds: 1,
      zeroSchema: 'xyne', zeroAppId: 'zero',
    },
  );

  assert.ok(invocation.args.includes('PERF_ZERO_SCHEMA'));
  assert.ok(invocation.args.includes('PERF_ZERO_APP_ID'));
  assert.equal(invocation.env.PERF_ZERO_SCHEMA, 'xyne');
  assert.equal(invocation.env.PERF_ZERO_APP_ID, 'zero');
});

test('refuses a zero-push run that cannot address the endpoint', () => {
  const { temporaryRoot, write } = fixtureWorkspace();
  write('many.json', identities(20));
  const usersFile = path.join(temporaryRoot, 'performance', 'test-data', 'many.json');
  const base = { PERF_BASE_URL: 'https://preprod.example', PERF_USERS_FILE: usersFile };

  // The push endpoint parses schema and appID from the querystring, so a run without
  // them would fail inside k6 after Docker has started. Refuse earlier.
  assert.throws(
    () => validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-push', profile: 'load' },
      env: base,
    }),
    /PERF_ZERO_SCHEMA is required/,
  );
  assert.throws(
    () => validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-push', profile: 'load' },
      env: { ...base, PERF_ZERO_SCHEMA: 'xyne' },
    }),
    /PERF_ZERO_APP_ID is required/,
  );
  assert.equal(
    validateRuntime({
      root: temporaryRoot,
      config: { scenario: 'zero-push', profile: 'load' },
      env: { ...base, PERF_ZERO_SCHEMA: 'xyne', PERF_ZERO_APP_ID: 'zero' },
    }).zeroSchema,
    'xyne',
  );
});

test('a container that never started is an environment fault, not a test failure', () => {
  // Observed live 2026-10-01: a memory-starved Docker daemon answered
  // "handle request: read response: unexpected EOF" and docker exited 125. Reporting
  // that as TEST_FAILURE sends the reader to debug the k6 script instead of Docker.
  // 125 = docker run itself failed; 126 = command not executable; 127 = command not found.
  assert.equal(classifyK6ExitCode(125), 'ENVIRONMENT_FAILURE');
  assert.equal(classifyK6ExitCode(126), 'ENVIRONMENT_FAILURE');
  assert.equal(classifyK6ExitCode(127), 'ENVIRONMENT_FAILURE');

  // The existing taxonomy must not shift.
  assert.equal(classifyK6ExitCode(0), 'PASS');
  assert.equal(classifyK6ExitCode(99), 'PRODUCT_FAILURE');
  assert.equal(classifyK6ExitCode(1), 'TEST_FAILURE');
});

test('an environment fault exits 2 however it was detected', () => {
  // The documented taxonomy maps ENVIRONMENT_FAILURE to exit 2. A Docker start failure
  // must not leak Docker's own 125 through, or CI branching on the exit code sees a
  // code the runbook does not describe.
  const reports = path.resolve(import.meta.dirname, '..', 'reports');
  const before = new Set(readdirSync(reports));

  // No PERF_BASE_URL: fails validation, which is the other ENVIRONMENT_FAILURE path.
  assert.equal(main([], {}), 2);

  assert.deepEqual(readdirSync(reports).filter((entry) => !before.has(entry)), []);
});

test('a Docker start failure exits 2, not Docker\'s own 125', () => {
  // The documented taxonomy maps ENVIRONMENT_FAILURE to exit 2. Leaking 125 through
  // would give CI a code the runbook does not describe.
  assert.equal(processExitCodeFor(125), 2);
  assert.equal(processExitCodeFor(126), 2);
  assert.equal(processExitCodeFor(127), 2);

  // Everything else keeps k6's own code, so 99 stays distinguishable.
  assert.equal(processExitCodeFor(0), 0);
  assert.equal(processExitCodeFor(99), 99);
  assert.equal(processExitCodeFor(1), 1);
});

test('refuses a production host unless the run is preprod', () => {
  // The name says sandbox, the traffic would hit customers.
  assert.throws(
    () => validateRuntime({
      root,
      config: { environment: 'sandbox', scenario: 'smoke', profile: 'smoke' },
      env: { PERF_BASE_URL: 'https://app.spaces.xyne.juspay.net' },
    }),
    /serves production/i,
  );
  assert.throws(
    () => validateRuntime({
      root,
      config: { scenario: 'smoke', profile: 'smoke' },
      env: { PERF_BASE_URL: 'https://auth.spaces.xyne.juspay.net/api' },
    }),
    /serves production/i,
  );
});

test('accepts the production host for a preprod run, which has no host of its own', () => {
  assert.equal(
    validateRuntime({
      root,
      config: { environment: 'preprod', scenario: 'smoke', profile: 'smoke' },
      env: { PERF_BASE_URL: 'https://app.spaces.xyne.juspay.net' },
    }).baseUrl,
    'https://app.spaces.xyne.juspay.net',
  );
});

test('still accepts sandbox and other non-production hosts', () => {
  assert.equal(
    validateRuntime({
      root,
      config: { scenario: 'smoke', profile: 'smoke' },
      env: { PERF_BASE_URL: 'https://spaces.sandbox.xyne.juspay.net' },
    }).baseUrl,
    'https://spaces.sandbox.xyne.juspay.net',
  );
});
