import { buildExecutionProfile } from '../profiles.mjs';

function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveNumber(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRunConfig() {
  return {
    baseUrl: required('PERF_BASE_URL').replace(/\/$/, ''),
    environment: __ENV.PERF_ENVIRONMENT || 'sandbox',
    profile: __ENV.PERF_PROFILE || 'smoke',
    scenario: __ENV.PERF_SCENARIO || 'smoke',
    runId: __ENV.PERF_RUN_ID || 'local',
    releaseVersion: __ENV.PERF_RELEASE_VERSION || 'local',
    thinkTimeSeconds: positiveNumber(__ENV.PERF_THINK_TIME_SECONDS, 1),
    enforcePerformanceThresholds: __ENV.PERF_ENFORCE_THRESHOLDS === 'true',
  };
}

export function buildOptions(config) {
  const thresholds = {
    correctness_failures: ['rate==0'],
  };

  if (config.enforcePerformanceThresholds) {
    thresholds['http_req_failed'] = ['rate<0.01'];
    if (config.scenario === 'rest-messaging') {
      thresholds['message_send_duration'] = ['p(95)<300'];
    }
    if (config.scenario === 'zero-query-transform') {
      thresholds['zero_query_duration'] = ['p(95)<400'];
    }
  }

  return {
    discardResponseBodies: false,
    systemTags: [
      'status',
      'method',
      'name',
      'group',
      'check',
      'error',
      'error_code',
      'scenario',
      'expected_response',
    ],
    scenarios: {
      [config.scenario]: buildExecutionProfile(config.profile, {
        vus: __ENV.PERF_VUS_OVERRIDE ? Number(__ENV.PERF_VUS_OVERRIDE) : undefined,
        duration: __ENV.PERF_DURATION_OVERRIDE || undefined,
      }),
    },
    thresholds,
    tags: {
      test_run_id: config.runId,
      release_version: config.releaseVersion,
      environment: config.environment,
      profile: config.profile,
      scenario: config.scenario,
    },
  };
}

export function readinessUrl(config) {
  return `${config.baseUrl}/api/health/readiness`;
}

export function zeroQueryUrl(config) {
  return `${config.baseUrl}/api/zero/query`;
}
