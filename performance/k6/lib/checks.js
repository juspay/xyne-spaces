import { check } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

import { readinessUrl } from './config.js';

export const correctnessFailures = new Rate('correctness_failures');
export const messageSendDuration = new Trend('message_send_duration', true);
export const zeroQueryDuration = new Trend('zero_query_duration', true);
export const searchDuration = new Trend('search_duration', true);
export const attachmentDuration = new Trend('attachment_duration', true);

export function verify(response, assertions, tags = {}) {
  const passed = check(response, assertions, tags);
  correctnessFailures.add(!passed, tags);
  return passed;
}

export function parseJson(response) {
  try {
    return response.json();
  } catch (_error) {
    return null;
  }
}

/** Check the readiness endpoint and report whether the target can take traffic. */
export function checkReadiness(config, headers) {
  const response = http.get(readinessUrl(config), { headers, tags: { operation: 'readiness' } });
  const body = parseJson(response);
  return verify(response, {
    'readiness returns 200': (result) => result.status === 200,
    'readiness reports success': () => body?.success === true,
    'database is ready': () => body?.data?.status === 'ready',
  }, { operation: 'readiness' });
}

/** Stop the run before load starts when the target is not ready. */
export function assertReady(config, headers) {
  if (!checkReadiness(config, headers)) throw new Error('ENVIRONMENT_FAILURE: target is not ready');
}
