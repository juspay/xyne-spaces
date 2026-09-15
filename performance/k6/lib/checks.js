import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const correctnessFailures = new Rate('correctness_failures');
export const messageSendDuration = new Trend('message_send_duration', true);
export const zeroQueryDuration = new Trend('zero_query_duration', true);

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
