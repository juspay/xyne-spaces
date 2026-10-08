import { checkReadiness } from '../lib/checks.js';
import { buildOptions, getRunConfig } from '../lib/config.js';
import { buildSummary } from '../lib/report.js';
import { routeEnvHeaders } from '../env-routing.mjs';

const config = getRunConfig();

const ROUTE_HEADERS = routeEnvHeaders(config.environment);

export const options = buildOptions(config);

export default function () {
  checkReadiness(config, ROUTE_HEADERS);
}

export function handleSummary(data) {
  return buildSummary(data, config);
}
