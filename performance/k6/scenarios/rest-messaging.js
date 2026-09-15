import { sleep } from 'k6';
import http from 'k6/http';

import { messageSendDuration, parseJson, verify } from '../lib/checks.js';
import { buildOptions, getRunConfig, readinessUrl } from '../lib/config.js';
import { authenticatedHeaders, userForVirtualUser } from '../lib/data.js';
import { buildSummary } from '../lib/report.js';

const config = getRunConfig();

export const options = buildOptions(config);

export function setup() {
  const response = http.get(readinessUrl(config), {
    tags: { operation: 'readiness' },
  });
  const body = parseJson(response);
  const ready = verify(response, {
    'readiness returns 200': (result) => result.status === 200,
    'readiness reports success': () => body?.success === true,
    'database is ready': () => body?.data?.status === 'ready',
  }, { operation: 'readiness' });

  if (!ready) throw new Error('ENVIRONMENT_FAILURE: target is not ready');
  return { runId: config.runId };
}

export default function (setupData) {
  const user = userForVirtualUser(__VU);
  const marker = `PERF-${setupData.runId}-${user.userId}-${__VU}-${__ITER}`;
  const response = http.post(
    `${config.baseUrl}/api/conversations/${encodeURIComponent(user.conversationId)}/messages`,
    JSON.stringify({ content: marker, msgType: 'USER' }),
    {
      headers: authenticatedHeaders(user),
      tags: { operation: 'message_send', name: 'POST /api/conversations/:id/messages' },
    },
  );
  const body = parseJson(response);

  messageSendDuration.add(response.timings.duration, { operation: 'message_send' });
  verify(response, {
    'message send returns 201': (result) => result.status === 201,
    'message send returns an id': () => typeof body?.messageId === 'string' && body.messageId.length > 0,
    'message belongs to fixture conversation': () => body?.conversationId === user.conversationId,
  }, { operation: 'message_send' });

  sleep(config.thinkTimeSeconds);
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
