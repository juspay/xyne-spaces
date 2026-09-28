// Read-only load for GET /api/vespaSearch/ — ACL-filtered Vespa retrieval.
//
// WHAT THIS MEASURES: authentication, workspace-context resolution, query validation,
// ACL-filtered retrieval from Vespa, and result serialisation. Unlike the Zero
// query-transform scenario, this one does execute a real retrieval and return rows, so
// its latency reflects actual search work.
//
// WHAT IT DOES NOT MEASURE: Vespa ingestion or index freshness (Wave 3), and nothing on
// the write or real-time path.
//
// Reads only, so a run leaves no rows behind and needs no fixture reset.

import http from 'k6/http';
import { sleep } from 'k6';

import { parseJson, searchDuration, verify } from '../lib/checks.js';
import { buildOptions, getRunConfig, readinessUrl, searchUrl } from '../lib/config.js';
import { authenticatedHeaders, userForVirtualUser } from '../lib/data.js';
import { buildSummary } from '../lib/report.js';
import {
  SEARCH_APP_SETS,
  buildSearchPath,
  searchResults,
  selectSearchTerms,
} from '../search-queries.mjs';

const config = getRunConfig();

export const options = buildOptions(config);

const PAGE_SIZE = 20;

function requestSearch(user, path) {
  return http.get(searchUrl(config, path), {
    headers: authenticatedHeaders(user),
    tags: { operation: 'search', name: 'GET /api/vespaSearch' },
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

  // One authenticated search before load starts, so a stale token or a changed contract
  // fails now rather than as a latency regression at peak.
  const probeUser = userForVirtualUser(1);
  const probePath = buildSearchPath({
    term: selectSearchTerms(probeUser)[0],
    apps: SEARCH_APP_SETS[0],
    limit: 1,
    offset: 0,
  });
  const response = requestSearch(probeUser, probePath);

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `ENVIRONMENT_FAILURE: fixture token rejected with ${response.status}; `
      + 'mint fresh tokens and confirm the identity has workspace context',
    );
  }

  const body = parseJson(response);
  if (response.status !== 200 || body?.success !== true) {
    throw new Error(
      `ENVIRONMENT_FAILURE: /api/vespaSearch rejected the probe (status ${response.status}: `
      + `${body?.error ?? 'no error body'})`,
    );
  }
  if (searchResults(body) === undefined) {
    throw new Error('ENVIRONMENT_FAILURE: search response carried no results array');
  }

  return { runId: config.runId };
}

export default function () {
  const user = userForVirtualUser(__VU);
  const terms = selectSearchTerms(user);

  // Rotate term and corpus per iteration so the run does not measure one cached query.
  const term = terms[__ITER % terms.length];
  const apps = SEARCH_APP_SETS[__ITER % SEARCH_APP_SETS.length];
  const path = buildSearchPath({ term, apps, limit: PAGE_SIZE, offset: 0 });

  const response = requestSearch(user, path);
  searchDuration.add(response.timings.duration, { operation: 'search' });

  const body = parseJson(response);
  const results = searchResults(body);

  verify(response, {
    'search returns 200': (result) => result.status === 200,
    'search is not rate limited': (result) => result.status !== 429,
    'search reports success': () => body?.success === true,
    'search returns a results array': () => Array.isArray(results),
    'result page respects the requested limit': () =>
      Array.isArray(results) && results.length <= PAGE_SIZE,
  }, { operation: 'search' });

  sleep(config.thinkTimeSeconds);
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
