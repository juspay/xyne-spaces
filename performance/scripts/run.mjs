#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { K6_IMAGE, resolveRunConfig } from '../config/catalog.mjs';
import { minimumIdentities, resolveZeroRequestBudget } from '../config/rate-limit.mjs';
import { buildExecutionProfile, peakVus } from '../k6/profiles.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAFE_METADATA = /^[A-Za-z0-9._-]+$/;
const DEFAULT_THINK_TIME_SECONDS = 1;

// Scenarios that authenticate as a test identity need the fixture. Of those, only the
// ones that call /api/zero/* are metered by the per-user Zero limiter, so only they
// carry an identity-count floor.
const FIXTURE_SCENARIOS = new Set(['zero-query-transform', 'rest-messaging']);
const ZERO_METERED_SCENARIOS = new Set(['zero-query-transform']);

export function parseCliArgs(argv) {
  const parsed = { dryRun: false };
  const keys = {
    '--environment': 'environment',
    '--profile': 'profile',
    '--scenario': 'scenario',
    '--vus': 'vusOverride',
    '--duration': 'durationOverride',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    const key = keys[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

export function buildRunInput(cli, env) {
  return {
    environment: cli.environment ?? env.PERF_ENVIRONMENT,
    profile: cli.profile ?? env.PERF_PROFILE,
    scenario: cli.scenario ?? env.PERF_SCENARIO,
    vusOverride: cli.vusOverride ?? env.PERF_VUS_OVERRIDE,
    durationOverride: cli.durationOverride ?? env.PERF_DURATION_OVERRIDE,
    allowWriteScenarios: env.PERF_ALLOW_WRITE_SCENARIOS === 'true',
  };
}

function requireHttpUrl(value) {
  if (!value) throw new Error('PERF_BASE_URL is required');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('PERF_BASE_URL must be a valid http or https URL');
  }
}

function optionalHttpUrl(value, label) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    if (url.username || url.password) {
      throw new Error(`${label} must not embed credentials; use separate credential variables`);
    }
    return url.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('must not embed credentials')) throw error;
    throw new Error(`${label} must be a valid http or https URL`);
  }
}

function requireSafeMetadata(value, label, fallback) {
  const resolved = value || fallback;
  if (!SAFE_METADATA.test(resolved)) {
    throw new Error(`${label} may contain only letters, numbers, dot, underscore, and dash`);
  }
  return resolved;
}

function validateUsersFixture(file) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('PERF_USERS_FILE must contain valid JSON');
  }

  if (!Array.isArray(payload.users) || payload.users.length === 0) {
    throw new Error('PERF_USERS_FILE must contain at least one user');
  }

  const requiredFields = ['userId', 'token', 'workspaceId', 'conversationId'];
  for (const [index, user] of payload.users.entries()) {
    const missing = requiredFields.filter(
      (field) => typeof user?.[field] !== 'string' || user[field].trim() === '',
    );
    if (missing.length > 0) {
      throw new Error(
        `PERF_USERS_FILE user ${index} requires userId, token, workspaceId, and conversationId`,
      );
    }
  }

  return payload.users.length;
}

function parseThinkTime(value) {
  if (value === undefined || value === '') return DEFAULT_THINK_TIME_SECONDS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('PERF_THINK_TIME_SECONDS must be a positive number');
  }
  return parsed;
}

/**
 * Refuse a Zero run that cannot reach its target rate without tripping the
 * per-identity limiter, because such a run reports the limiter as a product failure.
 */
function requireRateLimitHeadroom({ config, env, identityCount, thinkTimeSeconds }) {
  const { maxRequests, windowSeconds } = resolveZeroRequestBudget(env);
  const required = minimumIdentities({
    peakVus: peakVus(buildExecutionProfile(config.profile, { vus: config.vusOverride })),
    thinkTimeSeconds,
    maxRequests,
    windowSeconds,
  });

  if (identityCount < required) {
    throw new Error(
      `PERF_USERS_FILE needs at least ${required} identities for the ${config.profile} `
      + `profile at ${thinkTimeSeconds}s think time; it has ${identityCount}. `
      + `The Zero endpoints allow ${maxRequests} requests per ${windowSeconds}s per user, `
      + 'so a smaller fixture measures the rate limiter instead of the application. '
      + 'Add identities, or set PERF_ZERO_MAX_REQUESTS to the limit configured on the target.',
    );
  }
}

export function validateRuntime({ root, config = {}, env }) {
  const baseUrl = requireHttpUrl(env.PERF_BASE_URL);
  const releaseVersion = requireSafeMetadata(env.PERF_RELEASE_VERSION, 'PERF_RELEASE_VERSION', 'local');
  const thinkTimeSeconds = parseThinkTime(env.PERF_THINK_TIME_SECONDS);
  let usersFile;
  let identityCount;

  if (FIXTURE_SCENARIOS.has(config.scenario)) {
    if (!env.PERF_USERS_FILE) {
      throw new Error(`PERF_USERS_FILE is required for the ${config.scenario} scenario`);
    }
    const candidate = path.resolve(root, env.PERF_USERS_FILE);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw new Error('PERF_USERS_FILE must reference an existing file');
    }
    usersFile = realpathSync(candidate);
    identityCount = validateUsersFixture(usersFile);

    if (ZERO_METERED_SCENARIOS.has(config.scenario)) {
      requireRateLimitHeadroom({ config, env, identityCount, thinkTimeSeconds });
    }
  }

  return {
    baseUrl,
    releaseVersion,
    thinkTimeSeconds,
    identityCount,
    token: env.PERF_TEST_TOKEN,
    workspaceId: env.PERF_WORKSPACE_ID,
    usersFile,
    remoteWriteUrl: optionalHttpUrl(env.PERF_REMOTE_WRITE_URL, 'PERF_REMOTE_WRITE_URL'),
    remoteWriteUsername: env.PERF_REMOTE_WRITE_USERNAME,
    remoteWritePassword: env.PERF_REMOTE_WRITE_PASSWORD,
    enforceThresholds: env.PERF_ENFORCE_THRESHOLDS === 'true',
  };
}

function addForwardedEnvironment(args, childEnv, name, value) {
  if (value === undefined || value === '') return;
  childEnv[name] = String(value);
  args.push('--env', name);
}

export function classifyK6ExitCode(status) {
  if (status === 0) return 'PASS';
  // k6 reserves exit code 99 for one or more failed thresholds.
  if (status === 99) return 'PRODUCT_FAILURE';
  return 'TEST_FAILURE';
}

export function buildDockerInvocation(config, runtime) {
  const args = [
    'run',
    '--rm',
    '--volume', `${runtime.root}:/work:ro`,
    '--volume', `${runtime.reportDirectory}:/reports`,
    '--workdir', '/work',
  ];
  const env = { ...process.env };

  const forwarded = {
    PERF_BASE_URL: runtime.baseUrl,
    PERF_TEST_TOKEN: runtime.token,
    PERF_WORKSPACE_ID: runtime.workspaceId,
    PERF_ENVIRONMENT: config.environment,
    PERF_PROFILE: config.profile,
    PERF_SCENARIO: config.scenario,
    PERF_RUN_ID: runtime.runId,
    PERF_RELEASE_VERSION: runtime.releaseVersion,
    PERF_THINK_TIME_SECONDS: runtime.thinkTimeSeconds,
    PERF_VUS_OVERRIDE: config.vusOverride,
    PERF_DURATION_OVERRIDE: config.durationOverride,
    PERF_ENFORCE_THRESHOLDS: runtime.enforceThresholds ? 'true' : undefined,
    K6_REPORT_DIR: '/reports',
    K6_WEB_DASHBOARD: 'true',
    K6_WEB_DASHBOARD_PORT: '-1',
    K6_WEB_DASHBOARD_EXPORT: '/reports/report.html',
    K6_PROMETHEUS_RW_SERVER_URL: runtime.remoteWriteUrl,
    K6_PROMETHEUS_RW_USERNAME: runtime.remoteWriteUsername,
    K6_PROMETHEUS_RW_PASSWORD: runtime.remoteWritePassword,
    K6_PROMETHEUS_RW_TREND_STATS: runtime.remoteWriteUrl ? 'p(50),p(90),p(95),p(99),max' : undefined,
  };

  for (const [name, value] of Object.entries(forwarded)) {
    addForwardedEnvironment(args, env, name, value);
  }

  if (runtime.usersFile) {
    args.push('--volume', `${runtime.usersFile}:/perf-secrets/users.json:ro`);
    addForwardedEnvironment(args, env, 'PERF_USERS_FILE', '/perf-secrets/users.json');
  }

  args.push(K6_IMAGE, 'run', '--quiet');
  if (runtime.remoteWriteUrl) args.push('-o', 'experimental-prometheus-rw');
  args.push(`/work/performance/k6/scenarios/${config.scenario}.js`);

  return {
    command: 'docker',
    args,
    env,
    safeDisplay: ['docker', ...args].join(' '),
  };
}

function createRunId(now = new Date()) {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const cli = parseCliArgs(argv);
    const config = resolveRunConfig(buildRunInput(cli, env));
    const runtime = validateRuntime({ root: REPOSITORY_ROOT, config, env });
    const runId = createRunId();
    const reportDirectory = path.join(REPOSITORY_ROOT, 'performance', 'reports', runId);

    const invocation = buildDockerInvocation(config, {
      root: REPOSITORY_ROOT,
      reportDirectory,
      runId,
      ...runtime,
    });

    console.log(`Performance run: ${runId}`);
    console.log(`Environment: ${config.environment}; profile: ${config.profile}; scenario: ${config.scenario}`);
    console.log(`Reports: ${reportDirectory}`);

    if (cli.dryRun) {
      console.log(`Dry run command: ${invocation.safeDisplay}`);
      return 0;
    }

    // Created only for a real run, so a dry run leaves no empty directory behind.
    mkdirSync(reportDirectory, { recursive: true });

    const result = spawnSync(invocation.command, invocation.args, {
      stdio: 'inherit',
      env: invocation.env,
    });
    if (result.error) {
      throw new Error(`unable to start Docker (${result.error.message})`);
    }
    const status = result.status ?? 1;
    const classification = classifyK6ExitCode(status);
    if (classification !== 'PASS') {
      console.error(`${classification}: k6 exited with status ${status}; inspect the archived report`);
    }
    return status;
  } catch (error) {
    console.error(`ENVIRONMENT_FAILURE: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) process.exitCode = main();
