// Read-only load for attachment retrieval — GET /api/attachments/:id/{download,thumbnail}.
//
// WHAT THIS MEASURES: authentication, the per-attachment access check, object-storage
// retrieval and byte transfer. Production carries roughly 1.0M downloads per fortnight at
// a p99 near 2.5s, and the cost sits in retrieval rather than application logic.
//
// WHAT IT DOES NOT MEASURE: upload, thumbnail generation, or the Vespa indexing that
// follows an upload.
//
// COST: this moves real bytes out of object storage on every iteration. Identifiers come
// from the fixture so an operator chooses which files a run touches, and bodies are
// discarded after transfer (`responseType: 'none'`) so latency is measured without
// buffering whole files in memory. Prefer small files, and watch egress on long runs.
//
// Reads only, so a run leaves no rows behind and needs no fixture reset.

import http from 'k6/http';
import { sleep } from 'k6';

import { attachmentDuration, parseJson, verify } from '../lib/checks.js';
import { buildOptions, getRunConfig, pathUrl, readinessUrl } from '../lib/config.js';
import { authenticatedHeaders, userForVirtualUser } from '../lib/data.js';
import { buildSummary } from '../lib/report.js';
import { routeEnvHeaders } from '../env-routing.mjs';
import {
  ATTACHMENT_KINDS,
  buildAttachmentPath,
  selectAttachmentIds,
} from '../attachment-requests.mjs';

const config = getRunConfig();

const ROUTE_HEADERS = routeEnvHeaders(config.environment);

export const options = buildOptions(config);

function requestAttachment(user, path) {
  return http.get(pathUrl(config, path), {
    headers: authenticatedHeaders(user, ROUTE_HEADERS),
    // Transfer the bytes but do not keep them: we want retrieval latency, not the file.
    responseType: 'none',
    tags: { operation: 'attachment', name: 'GET /api/attachments/:id' },
  });
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

  const probeUser = userForVirtualUser(1);
  const ids = selectAttachmentIds(probeUser);
  if (ids.length === 0) {
    throw new Error(
      'ENVIRONMENT_FAILURE: PERF_USERS_FILE supplies no attachmentIds; the attachments '
      + 'scenario needs at least one readable attachment id per identity',
    );
  }

  const response = requestAttachment(probeUser, buildAttachmentPath(ids[0], 'download'));

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `ENVIRONMENT_FAILURE: fixture token rejected with ${response.status}; mint fresh tokens`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `ENVIRONMENT_FAILURE: attachment ${ids[0]} was not found or is not yet uploaded; `
      + 'a run against a missing id would measure the not-found path',
    );
  }
  if (response.status !== 200) {
    throw new Error(
      `ENVIRONMENT_FAILURE: attachment retrieval returned ${response.status}`,
    );
  }

  return { runId: config.runId };
}

export default function () {
  const user = userForVirtualUser(__VU);
  const ids = selectAttachmentIds(user);
  if (ids.length === 0) return;

  // Rotate file and retrieval kind so the run is not one cached object.
  const attachmentId = ids[__ITER % ids.length];
  const kind = ATTACHMENT_KINDS[__ITER % ATTACHMENT_KINDS.length];
  const response = requestAttachment(user, buildAttachmentPath(attachmentId, kind));

  attachmentDuration.add(response.timings.duration, { operation: 'attachment', kind });

  verify(response, {
    'attachment returns 200': (result) => result.status === 200,
    'attachment is not rate limited': (result) => result.status !== 429,
    'attachment was found': (result) => result.status !== 404,
    'attachment transferred bytes': (result) => result.body === null || result.body.length >= 0,
  }, { operation: 'attachment', kind });

  sleep(config.thinkTimeSeconds);
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
