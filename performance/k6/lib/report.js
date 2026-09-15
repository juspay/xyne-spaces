const startedAt = new Date().toISOString();

function metricValue(data, metric, field) {
  return data.metrics?.[metric]?.values?.[field];
}

export function buildSummary(data, config) {
  const endedAt = new Date().toISOString();
  const metadata = {
    runId: config.runId,
    releaseVersion: config.releaseVersion,
    environment: config.environment,
    profile: config.profile,
    scenario: config.scenario,
    performanceThresholdsEnforced: config.enforcePerformanceThresholds,
    startedAt,
    endedAt,
  };
  const concise = {
    ...metadata,
    checksPassRate: metricValue(data, 'checks', 'rate'),
    requestFailureRate: metricValue(data, 'http_req_failed', 'rate'),
    requestDurationP95Ms: metricValue(data, 'http_req_duration', 'p(95)'),
    messageSendP95Ms: metricValue(data, 'message_send_duration', 'p(95)'),
    zeroQueryP95Ms: metricValue(data, 'zero_query_duration', 'p(95)'),
  };
  const reportDirectory = __ENV.K6_REPORT_DIR || '/reports';

  return {
    stdout: `\nPerformance summary\n${JSON.stringify(concise, null, 2)}\n`,
    [`${reportDirectory}/summary.json`]: JSON.stringify(data, null, 2),
    [`${reportDirectory}/metadata.json`]: JSON.stringify(metadata, null, 2),
  };
}
