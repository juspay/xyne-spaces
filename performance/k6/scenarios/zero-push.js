// Write load for POST /api/zero/push — the mutation path behind the chat send action, and
// the Wave 1 first milestone in docs/performance-testing-priority-decision.md. Production
// carries ~1.1M pushes per fortnight at a p95 near 976ms.
//
// WHAT THIS MEASURES: authentication, the per-user Zero rate limiter, ACL wrapping, the
// `messages.send` mutator itself, and the work it schedules — Vespa indexing jobs, unread
// recomputation and the side-effect cascade. This is the O(participants) amplification the
// priority report identified.
//
// WHAT IT DOES NOT MEASURE: zero-cache. ZERO_MUTATE_URL shows the cache service calls this
// endpoint rather than the browser, so hitting it directly bypasses the sync layer where
// hydration and serving lag live. Socket delivery and presence are likewise not covered.
//
// WRITES: every iteration inserts a message. Content carries a PERF-<run-id> marker so
// rows can be found and removed. Gated behind PERF_ALLOW_WRITE_SCENARIOS until a reset
// mechanism exists.

import http from 'k6/http';
import { sleep } from 'k6';

import { messageSendDuration, parseJson, verify } from '../lib/checks.js';
import { buildOptions, getRunConfig, pathUrl, readinessUrl } from '../lib/config.js';
import { authenticatedHeaders, userForVirtualUser } from '../lib/data.js';
import { buildSummary } from '../lib/report.js';
import { routeEnvHeaders } from '../env-routing.mjs';
import {
  buildClientIdentity,
  buildMutatePath,
  buildPushBody,
  isPushFailure,
  mutationError,
  mutationResults,
} from '../zero-push.mjs';

const config = getRunConfig();

const ROUTE_HEADERS = routeEnvHeaders(config.environment);

export const options = buildOptions(config);

const MUTATE_PATH = buildMutatePath({
  schema: __ENV.PERF_ZERO_SCHEMA,
  appID: __ENV.PERF_ZERO_APP_ID,
});
const MESSAGE_TYPE = __ENV.PERF_MESSAGE_TYPE || 'USER';

// k6 gives each virtual user its own module instance, so this counter is per-VU — which is
// exactly the scope Zero's mutation ordering requires.
let mutationCounter = 0;

function pushMessage(user, body) {
  return http.post(pathUrl(config, MUTATE_PATH), JSON.stringify(body), {
    headers: authenticatedHeaders(user, ROUTE_HEADERS),
    tags: { operation: 'zero_push', name: 'POST /api/zero/push' },
  });
}

function sendArgs(user, marker, timestamp) {
  return {
    conversationId: user.conversationId,
    content: marker,
    type: MESSAGE_TYPE,
    showInChannel: false,
    timestamp,
    messageId: `${marker}-msg`,
  };
}

export function setup() {
  const readiness = http.get(readinessUrl(config), { headers: ROUTE_HEADERS, tags: { operation: 'readiness' } });
  const readinessBody = parseJson(readiness);
  const ready = verify(readiness, {
    'readiness returns 200': (result) => result.status === 200,
    'readiness reports success': () => readinessBody?.success === true,
    'database is ready': () => readinessBody?.data?.status === 'ready',
  }, { operation: 'readiness' });

  if (!ready) throw new Error('ENVIRONMENT_FAILURE: target is not ready');

  // One real mutation before load starts. This is the only way to confirm the schema and
  // appID parameters, the mutator name and the argument shape on this deployment.
  const probeUser = userForVirtualUser(1);
  const identity = buildClientIdentity(`${config.runId}-probe`, 0);
  const timestamp = Date.now();
  const marker = `PERF-${config.runId}-probe`;
  const response = pushMessage(probeUser, buildPushBody({
    ...identity,
    mutationId: 1,
    timestamp,
    requestID: `${marker}-req`,
    args: sendArgs(probeUser, marker, timestamp),
  }));

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `ENVIRONMENT_FAILURE: fixture token rejected with ${response.status}; mint fresh tokens`,
    );
  }

  const body = parseJson(response);

  if (isPushFailure(body)) {
    throw new Error(
      `ENVIRONMENT_FAILURE: /api/zero/push rejected the batch (${body.reason ?? 'unknown'}: `
      + `${body.message ?? 'no message'}). If the reason is parse or unsupportedPushVersion, `
      + 'check PERF_ZERO_SCHEMA and PERF_ZERO_APP_ID match this deployment.',
    );
  }

  const results = mutationResults(body);
  if (response.status !== 200 || results === undefined || results.length !== 1) {
    throw new Error(
      `ENVIRONMENT_FAILURE: unexpected /api/zero/push response (status ${response.status})`,
    );
  }

  const error = mutationError(results[0]);
  if (error !== undefined) {
    throw new Error(
      `ENVIRONMENT_FAILURE: probe mutation returned ${error} `
      + `(${results[0].result?.message ?? 'no message'}); check the mutator name and arguments`,
    );
  }

  return { runId: config.runId };
}

export default function (setupData) {
  const user = userForVirtualUser(__VU);
  const identity = buildClientIdentity(setupData.runId, __VU);

  mutationCounter += 1;
  const timestamp = Date.now();
  const marker = `PERF-${setupData.runId}-${user.userId}-${__VU}-${mutationCounter}`;

  const response = pushMessage(user, buildPushBody({
    ...identity,
    mutationId: mutationCounter,
    timestamp,
    requestID: `${marker}-req`,
    args: sendArgs(user, marker, timestamp),
  }));

  messageSendDuration.add(response.timings.duration, { operation: 'zero_push' });

  const body = parseJson(response);
  const results = mutationResults(body);

  verify(response, {
    'push returns 200': (result) => result.status === 200,
    'push is not rate limited': (result) => result.status !== 429,
    'push was not rejected': () => !isPushFailure(body),
    'one result per mutation': () => Array.isArray(results) && results.length === 1,
    'mutation applied without error': () =>
      Array.isArray(results) && mutationError(results[0]) === undefined,
  }, { operation: 'zero_push' });

  sleep(config.thinkTimeSeconds);
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
