// Authenticated Zero query-transform load for POST /api/zero/query.
//
// SCOPE — read this before interpreting a report.
//
// This exercises the *query-transform* step only: authentication, the per-user Zero rate
// limiter, query construction, `scopeQueryToTenant`, ACL application, and AST compilation
// (apps/backend/src/zero/server.ts -> handleQueryRequest).
//
// It is NOT a Zero-sync test and NOT a full read-load test:
//   - No Postgres execution. The endpoint answers with compiled ASTs; rows reach clients
//     over the Zero sync socket, which k6 does not touch here.
//   - No push/mutation path, no Socket.IO or Redis fan-out, no unread recomputation, no
//     message side effects. Those are the Wave-1 pipeline in
//     docs/performance-testing-priority-decision.md and remain uncovered.
//
// Reads only, so a run leaves no rows behind and needs no fixture reset.

import http from 'k6/http';
import { sleep } from 'k6';

import { parseJson, verify, zeroQueryDuration } from '../lib/checks.js';
import { buildOptions, getRunConfig, readinessUrl, zeroQueryUrl } from '../lib/config.js';
import { authenticatedHeaders, userForVirtualUser } from '../lib/data.js';
import { buildSummary } from '../lib/report.js';
import {
  buildTransformMessage,
  isTransformFailure,
  selectQueries,
  transformEntries,
} from '../zero-queries.mjs';

const config = getRunConfig();

export const options = buildOptions(config);

function postTransform(user, message) {
  return http.post(zeroQueryUrl(config), JSON.stringify(message), {
    headers: authenticatedHeaders(user),
    tags: { operation: 'zero_query_transform', name: 'POST /api/zero/query' },
  });
}

export function setup() {
  const readiness = http.get(readinessUrl(config), { tags: { operation: 'readiness' } });
  const readinessBody = parseJson(readiness);
  const ready = verify(readiness, {
    'readiness returns 200': (result) => result.status === 200,
    'readiness reports success': () => readinessBody?.success === true,
    'database is ready': () => readinessBody?.data?.status === 'ready',
  }, { operation: 'readiness' });

  if (!ready) throw new Error('ENVIRONMENT_FAILURE: target is not ready');

  // One authenticated request before load starts, so a stale fixture token or a changed
  // query contract fails now — as an environment fault at virtual-user 1 — rather than as
  // a latency regression at virtual-user 300.
  const probeUser = userForVirtualUser(1);
  const probeQueries = selectQueries(probeUser).slice(0, 1);
  if (probeQueries.length === 0) {
    throw new Error('ENVIRONMENT_FAILURE: no catalogued query is satisfiable by the fixture');
  }

  const response = postTransform(probeUser, buildTransformMessage(probeQueries, probeUser));

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `ENVIRONMENT_FAILURE: fixture token rejected with ${response.status}; mint fresh tokens`,
    );
  }

  const body = parseJson(response);

  // A parse or internal failure is served with HTTP 200, so the body decides, not the status.
  if (isTransformFailure(body)) {
    throw new Error(
      `ENVIRONMENT_FAILURE: /api/zero/query rejected the transform request `
      + `(${body.reason ?? 'unknown'}: ${body.message ?? 'no message'}); `
      + 'check the query contract against the installed @rocicorp/zero version',
    );
  }

  const entries = transformEntries(body);
  if (response.status !== 200 || entries === undefined || entries.length !== probeQueries.length) {
    throw new Error(
      `ENVIRONMENT_FAILURE: unexpected /api/zero/query response (status ${response.status})`,
    );
  }
  if (entries.some((entry) => entry.error !== undefined)) {
    throw new Error(
      `ENVIRONMENT_FAILURE: query '${entries[0].name}' returned `
      + `${entries[0].error}: ${entries[0].message ?? 'no message'}`,
    );
  }

  return { runId: config.runId };
}

export default function () {
  const user = userForVirtualUser(__VU);
  const descriptors = selectQueries(user);
  const response = postTransform(user, buildTransformMessage(descriptors, user));

  zeroQueryDuration.add(response.timings.duration, { operation: 'zero_query_transform' });

  const body = parseJson(response);
  const entries = transformEntries(body);

  verify(response, {
    'transform returns 200': (result) => result.status === 200,
    'transform is not rate limited': (result) => result.status !== 429,
    'transform was not rejected': () => !isTransformFailure(body),
    'one entry per requested query': () =>
      Array.isArray(entries) && entries.length === descriptors.length,
    'no query reports an error': () =>
      Array.isArray(entries) && entries.every((entry) => entry?.error === undefined),
  }, { operation: 'zero_query_transform' });

  sleep(config.thinkTimeSeconds);
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
