import { METRIC_SPECS, formatMetric, VERDICT_STYLES } from './thresholds';
import { METRIC_KEYS } from './types';
import type { DiagnosticsSnapshot, MetricKey, ZeroOpStat } from './types';

/** Groups in the order a reader should scan them: verdict first, then cause. */
const GROUP_ORDER: { group: string; title: string }[] = [
  { group: 'sync', title: 'Live sync' },
  { group: 'cpu', title: 'CPU' },
  { group: 'memory', title: 'Memory' },
  { group: 'latency', title: 'Network' },
];

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * A paste-ready summary for a support thread. Deliberately plain text: it has
 * to survive being pasted into Slack, a ticket, or an email without losing the
 * numbers, and it must be readable by someone who never opens the panel.
 */
export function buildReportMarkdown(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];
  const now = new Date(snapshot.updatedAt);

  lines.push('# Xyne performance report');
  lines.push('');
  lines.push(`- Generated: ${now.toISOString()}`);
  lines.push(`- Overall: **${VERDICT_STYLES[snapshot.overall].label}**`);
  lines.push(`- Session open for: ${formatDuration(snapshot.updatedAt - snapshot.startedAt)}`);
  if (snapshot.historyFrom) {
    lines.push(`- History since: ${new Date(snapshot.historyFrom).toISOString()}`);
  }
  lines.push('');

  lines.push('## Device');
  lines.push('');
  const device = snapshot.device;
  lines.push(`- Platform: ${device.platform}`);
  if (device.appVersion) lines.push(`- App version: ${device.appVersion}`);
  if (device.deviceId) lines.push(`- Device id: ${device.deviceId}`);
  lines.push(`- CPU cores: ${device.hardwareConcurrency ?? 'unknown'}`);
  lines.push(
    `- Device memory: ${device.deviceMemoryGb ? `${device.deviceMemoryGb} GB` : 'unknown'}`,
  );
  lines.push(`- Screen: ${device.screen} @ ${device.dpr}x`);
  if (device.connection) {
    lines.push(
      `- Network: ${device.connection.effectiveType}, ~${device.connection.rttMs}ms RTT, ~${device.connection.downlinkMbps} Mbps`,
    );
  }
  lines.push(`- User agent: ${device.userAgent}`);
  lines.push('');

  if (snapshot.cpu.systemCpuPercent !== null) {
    lines.push('## Machine CPU');
    lines.push('');
    lines.push(`- Whole machine busy: ${snapshot.cpu.systemCpuPercent.toFixed(0)}%`);
    lines.push(`- Xyne processes: ${(snapshot.cpu.appCpuPercent ?? 0).toFixed(0)}% of one core`);
    if (snapshot.cpu.appSharePercent !== null) {
      lines.push(`- Xyne's share of all CPU activity: ${snapshot.cpu.appSharePercent.toFixed(0)}%`);
    }
    if (snapshot.cpu.thermalState) lines.push(`- Thermal state: ${snapshot.cpu.thermalState}`);
    if (snapshot.cpu.onBatteryPower !== null) {
      lines.push(`- On battery: ${snapshot.cpu.onBatteryPower ? 'yes' : 'no'}`);
    }
    lines.push('');
  }

  for (const { group, title } of GROUP_ORDER) {
    const keys = METRIC_KEYS.filter(key => METRIC_SPECS[key].group === group);
    const rows = keys.filter(key => snapshot.metrics[key].value !== null);
    if (!rows.length) continue;

    lines.push(`## ${title}`);
    lines.push('');
    lines.push('| Metric | Value | Verdict |');
    lines.push('| --- | --- | --- |');
    for (const key of rows) {
      const metric = snapshot.metrics[key];
      lines.push(
        `| ${METRIC_SPECS[key].label} | ${formatMetric(key, metric.value)} | ${VERDICT_STYLES[metric.verdict].label} |`,
      );
    }
    const unsupported = keys.filter(key => !snapshot.metrics[key].supported);
    if (unsupported.length) {
      lines.push('');
      for (const key of unsupported) {
        lines.push(`> ${METRIC_SPECS[key].label}: ${snapshot.metrics[key].unsupportedReason}`);
      }
    }
    lines.push('');
  }

  const zero = snapshot.zeroConnection;
  if (zero.observingSince !== null) {
    lines.push('## Connection');
    lines.push('');
    lines.push(`- Current: ${zero.current}${zero.currentReason ? ` (${zero.currentReason})` : ''}`);
    lines.push(`- Observed since: ${new Date(zero.observingSince).toISOString()}`);
    lines.push(`- Unexpected drops in the last hour: ${zero.disconnects}`);
    lines.push(`- Hidden-tab disconnects (expected): ${zero.hiddenDisconnects}`);
    if (zero.reasons.length) {
      lines.push('');
      lines.push('| Drop reason | Count |');
      lines.push('| --- | --- |');
      for (const row of zero.reasons) lines.push(`| ${row.reason} | ${row.count} |`);
    }
    if (zero.recent.length) {
      lines.push('');
      lines.push('Recent transitions (newest first):');
      lines.push('');
      for (const event of zero.recent) {
        lines.push(
          `- ${new Date(event.t).toISOString()} → ${event.name}${event.reason ? ` (${event.reason})` : ''}`,
        );
      }
    }
    lines.push('');
  }

  appendZeroOpTable(lines, 'Slowest data requests', 'Query', snapshot.zeroQueries);
  appendZeroOpTable(lines, 'Slowest saves', 'Action', snapshot.zeroMutations);

  if (snapshot.scripts.length) {
    lines.push('## What is using the most CPU');
    lines.push('');
    lines.push(
      'Measured by the Long Animation Frames API — real script attribution, not estimates.',
    );
    lines.push('');
    lines.push('| Script | Function | Total ms | Calls | Forced layout ms |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const script of snapshot.scripts.slice(0, 10)) {
      lines.push(
        `| ${script.source} | ${script.fn} | ${script.totalMs.toFixed(0)} | ${script.count} | ${script.forcedLayoutMs.toFixed(0)} |`,
      );
    }
    lines.push('');
  }

  if (snapshot.api.length) {
    lines.push('## Slowest requests');
    lines.push('');
    lines.push('| Endpoint | Calls | p95 ms | Total ms | Transferred KB |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of snapshot.api.slice(0, 10)) {
      lines.push(
        `| ${row.endpoint} | ${row.count} | ${row.p95Ms.toFixed(0)} | ${row.totalMs.toFixed(0)} | ${row.transferKb.toFixed(0)} |`,
      );
    }
    lines.push('');
  }

  if (snapshot.electron?.length) {
    lines.push('## Processes');
    lines.push('');
    lines.push('| Process | PID | CPU % | Memory MB |');
    lines.push('| --- | --- | --- | --- |');
    for (const process of [...snapshot.electron]
      .sort((a, b) => b.cpuPercent - a.cpuPercent)
      .slice(0, 10)) {
      lines.push(
        `| ${process.name} (${process.type}) | ${process.pid} | ${process.cpuPercent.toFixed(0)} | ${process.workingSetMb.toFixed(0)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function appendZeroOpTable(
  lines: string[],
  title: string,
  nameHeader: string,
  rows: ZeroOpStat[],
): void {
  if (!rows.length) return;
  lines.push(`## ${title}`);
  lines.push('');
  lines.push(`| ${nameHeader} | Calls | p50 ms | p95 ms | Worst ms | Failed | Verdict |`);
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows.slice(0, 15)) {
    lines.push(
      `| ${row.name} | ${row.count} | ${row.p50Ms.toFixed(0)} | ${row.p95Ms.toFixed(0)} | ${row.maxMs.toFixed(0)} | ${row.errors} | ${VERDICT_STYLES[row.verdict].label} |`,
    );
  }
  lines.push('');
}

/** Full fidelity, including every retained data point, for engineering triage. */
export function buildReportJson(snapshot: DiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Human-readable one-liner naming the single worst thing, so the panel can lead
 * with a conclusion instead of making the user read a grid.
 */
export function summarize(snapshot: DiagnosticsSnapshot): string {
  if (snapshot.overall === 'good') return 'No performance problems detected in this session.';

  const offenders = METRIC_KEYS.filter(key => snapshot.metrics[key].verdict === snapshot.overall)
    .filter(key => key !== 'cpuPressure')
    .map(
      (key: MetricKey) =>
        `${METRIC_SPECS[key].label} (${formatMetric(key, snapshot.metrics[key].value)})`,
    );

  if (!offenders.length) return 'Still collecting measurements.';

  const worstScript = snapshot.scripts[0];
  const worstQuery = snapshot.zeroQueries.find(q => q.verdict === 'bad' || q.verdict === 'warn');
  const cause = worstQuery
    ? ` The slowest data request is "${worstQuery.name}" at ${worstQuery.p95Ms.toFixed(0)}ms.`
    : worstScript
      ? ` Most main-thread time is going to ${worstScript.fn} in ${worstScript.source}.`
      : '';
  const list = offenders.slice(0, 3).join(', ');

  return snapshot.overall === 'bad'
    ? `Performance is poor right now: ${list}.${cause}`
    : `Performance is degraded: ${list}.${cause}`;
}

/**
 * Short, bounded summary for posting into a channel.
 *
 * Deliberately not the full report. The heavy detail is already in the bridge
 * logs (`client_cpu_snapshot`, `client_script_drain`, `zero_query_complete`,
 * `zero_socket_disconnected`), so this carries the headline plus the identifiers
 * an agent needs to pull that history — rather than pasting a wall of text into
 * a conversation a human also has to read.
 */
export function buildChannelReportHtml(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  lines.push(
    `<p><strong>Performance report — ${escape(VERDICT_STYLES[snapshot.overall].label)}</strong></p>`,
  );
  lines.push(`<p>${escape(summarize(snapshot))}</p>`);

  const notable = METRIC_KEYS.filter(
    key => snapshot.metrics[key].verdict === 'bad' || snapshot.metrics[key].verdict === 'warn',
  );
  if (notable.length) {
    lines.push('<p><strong>Measurements outside their band</strong></p><ul>');
    for (const key of notable.slice(0, 8)) {
      const metric = snapshot.metrics[key];
      lines.push(
        `<li>${escape(METRIC_SPECS[key].label)}: ${escape(formatMetric(key, metric.value))} (${escape(VERDICT_STYLES[metric.verdict].label)})</li>`,
      );
    }
    lines.push('</ul>');
  }

  const worstScript = snapshot.scripts[0];
  if (worstScript) {
    lines.push(
      `<p><strong>Heaviest script:</strong> ${escape(worstScript.fn)} in ${escape(worstScript.source)} — ${worstScript.totalMs.toFixed(0)}ms across ${worstScript.count} calls</p>`,
    );
  }

  const zero = snapshot.zeroConnection;
  if (zero.observingSince !== null && zero.disconnects > 0) {
    const reason = zero.reasons[0];
    lines.push(
      `<p><strong>Connection:</strong> ${zero.disconnects} unexpected drop(s) in the last hour${reason ? ` — most common: ${escape(reason.reason)}` : ''}</p>`,
    );
  }

  // The join keys. An agent filters the bridge logs on these to get the full
  // history rather than relying on anything pasted here.
  lines.push('<p><strong>For investigation</strong></p><ul>');
  lines.push(`<li>Platform: ${escape(snapshot.device.platform)}</li>`);
  if (snapshot.device.appVersion) {
    lines.push(`<li>App version: ${escape(snapshot.device.appVersion)}</li>`);
  }
  if (snapshot.device.deviceId) {
    lines.push(`<li>service_instance_id: ${escape(snapshot.device.deviceId)}</li>`);
  }
  lines.push(`<li>Cores: ${snapshot.device.hardwareConcurrency ?? 'unknown'}</li>`);
  lines.push(`<li>Reported at: ${new Date(snapshot.updatedAt).toISOString()}</li>`);
  lines.push('</ul>');

  return lines.join('');
}

/**
 * Prompt for Ask AI. Plain markdown rather than the HTML the channel post uses,
 * and deliberately compact — it is auto-sent as a chat message, so it has to
 * read as a question a person could have typed, not a log dump.
 *
 * The trailing identifiers matter: if the assistant can reach the telemetry
 * pipeline, they are what lets it pull this user's history instead of reasoning
 * only from the snapshot pasted here.
 */
export function buildAskAiPrompt(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];
  const plural = (count: number, noun: string): string =>
    `${count} ${noun}${count === 1 ? '' : 's'}`;

  lines.push('Why is Xyne performing badly for me right now, and what can I do about it?');
  lines.push('');
  lines.push(`Overall: ${VERDICT_STYLES[snapshot.overall].label}. ${summarize(snapshot)}`);

  const notable = METRIC_KEYS.filter(
    key => snapshot.metrics[key].verdict === 'bad' || snapshot.metrics[key].verdict === 'warn',
  );
  if (notable.length) {
    lines.push('');
    lines.push('Measurements outside their healthy band:');
    for (const key of notable.slice(0, 8)) {
      const metric = snapshot.metrics[key];
      const spec = METRIC_SPECS[key];
      lines.push(
        `- ${spec.label}: ${formatMetric(key, metric.value)} (${VERDICT_STYLES[metric.verdict].label}; good is ${spec.direction === 'lower' ? 'under' : 'above'} ${spec.warnAt}${spec.unit ? ` ${spec.unit}` : ''})`,
      );
    }
  }

  const slowQueries = snapshot.zeroQueries.filter(q => q.verdict !== 'good').slice(0, 5);
  if (slowQueries.length) {
    lines.push('');
    lines.push('Slowest data requests:');
    for (const query of slowQueries) {
      // A row with no successful call has no percentile worth printing; the
      // failures are the whole story.
      const timing =
        query.count > 0
          ? `p95 ${query.p95Ms.toFixed(0)}ms over ${plural(query.count, 'call')}`
          : 'never completed';
      lines.push(
        `- ${query.name}: ${timing}${query.errors ? `, ${plural(query.errors, 'failure')}` : ''}`,
      );
    }
  }

  const scripts = snapshot.scripts.slice(0, 5);
  if (scripts.length) {
    lines.push('');
    lines.push('Code using the most main-thread time:');
    for (const script of scripts) {
      lines.push(
        `- ${script.fn} in ${script.source}: ${script.totalMs.toFixed(0)}ms over ${plural(script.count, 'call')}${script.forcedLayoutMs > 0 ? `, ${script.forcedLayoutMs.toFixed(0)}ms forced layout` : ''}`,
      );
    }
  }

  const zero = snapshot.zeroConnection;
  if (zero.observingSince !== null && zero.disconnects > 0) {
    lines.push('');
    lines.push(
      `Connection dropped unexpectedly ${plural(zero.disconnects, 'time')} in the last hour${zero.reasons[0] ? `, most often: ${zero.reasons[0].reason}` : ''}.`,
    );
  }

  lines.push('');
  lines.push(
    `Device: ${snapshot.device.platform}, ${snapshot.device.hardwareConcurrency ?? 'unknown'} cores${snapshot.device.appVersion ? `, app ${snapshot.device.appVersion}` : ''}.`,
  );
  if (snapshot.device.deviceId) {
    lines.push(
      `If you can query client telemetry, my events are in the logging bridge under service_instance_id ${snapshot.device.deviceId} (events: client_cpu_snapshot, client_script_drain, zero_query_complete, zero_socket_disconnected).`,
    );
  }

  return lines.join('\n');
}
