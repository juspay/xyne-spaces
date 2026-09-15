import http from 'k6/http';

import { parseJson, verify } from '../lib/checks.js';
import { buildOptions, getRunConfig, readinessUrl } from '../lib/config.js';
import { buildSummary } from '../lib/report.js';

const config = getRunConfig();

export const options = buildOptions(config);

export default function () {
  const response = http.get(readinessUrl(config), {
    tags: { operation: 'readiness' },
  });
  const body = parseJson(response);

  verify(response, {
    'readiness returns 200': (result) => result.status === 200,
    'readiness reports success': () => body?.success === true,
    'database is ready': () => body?.data?.status === 'ready',
  }, { operation: 'readiness' });
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
