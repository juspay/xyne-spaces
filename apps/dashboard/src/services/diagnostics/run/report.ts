import { CHECK_STATUS_STYLES, CONFIDENCE_LABELS } from '../thresholds';
import type { CheckResult, CheckStatus, RunReport } from './types';

/**
 * Exports for a finished run.
 *
 * Kept separate from the session report in `../report.ts`: that one describes
 * "the app over this session", while these describe "this measurement, over this
 * window, with these thresholds". Mixing them would produce a document whose
 * numbers come from two different timespans, which is exactly the confusion the
 * run exists to remove.
 */

const SECTION_ORDER: { status: CheckStatus; title: string }[] = [
  { status: 'fail', title: 'Problems' },
  { status: 'warn', title: 'Needs attention' },
  { status: 'inconclusive', title: 'Inconclusive' },
  { status: 'pass', title: 'Passed' },
  { status: 'skipped', title: 'Not measured' },
];

function byStatus(checks: CheckResult[], status: CheckStatus): CheckResult[] {
  return checks.filter(check => check.status === status);
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/** Paste-ready for a ticket or a support thread, readable without the panel. */
export function buildRunMarkdown(report: RunReport): string {
  const lines: string[] = [];

  lines.push('# Xyne diagnostic run');
  lines.push('');
  lines.push(`- Run at: ${new Date(report.startedAt).toISOString()}`);
  lines.push(`- Observed for: ${seconds(report.window.durationMs)}`);
  lines.push(`- Result: **${CHECK_STATUS_STYLES[report.overall].label}** — ${report.headline}`);
  lines.push(`- Screen: ${report.route}`);
  lines.push(
    `- During the run the app was: ${report.interactedDuringRun ? 'in use' : 'idle (nobody interacted)'}`,
  );
  lines.push(`- Engine version: ${report.engineVersion}`);
  lines.push('');

  lines.push('## Device');
  lines.push('');
  const device = report.device;
  lines.push(`- Platform: ${device.platform}`);
  if (device.appVersion) lines.push(`- App version: ${device.appVersion}`);
  if (device.deviceId) lines.push(`- service_instance_id: ${device.deviceId}`);
  lines.push(`- CPU cores: ${device.hardwareConcurrency ?? 'unknown'}`);
  lines.push(
    `- Device memory: ${device.deviceMemoryGb ? `${device.deviceMemoryGb} GB` : 'unknown'}`,
  );
  if (report.probes.cpu) {
    lines.push(
      `- Benchmark: ${Math.round(report.probes.cpu.speedIndex * 100)}% of reference speed (best slice ${report.probes.cpu.bestMs.toFixed(1)}ms of ${report.probes.cpu.slices})`,
    );
  }
  if (report.probes.storage?.supported) {
    lines.push(
      `- Storage: 320 KB write ${report.probes.storage.writeMs.toFixed(0)}ms, read ${report.probes.storage.readMs.toFixed(0)}ms`,
    );
  }
  if (report.probes.eventLoop) {
    lines.push(
      `- Event-loop lag: p50 ${report.probes.eventLoop.p50Ms.toFixed(0)}ms, p95 ${report.probes.eventLoop.p95Ms.toFixed(0)}ms, worst ${report.probes.eventLoop.maxMs.toFixed(0)}ms`,
    );
  }
  if (report.cpu.systemCpuPercent !== null) {
    lines.push(`- Machine busy: ${report.cpu.systemCpuPercent.toFixed(0)}%`);
    lines.push(`- Xyne share of that: ${(report.cpu.appSharePercent ?? 0).toFixed(0)}%`);
    if (report.cpu.thermalState) lines.push(`- Thermal state: ${report.cpu.thermalState}`);
  }
  lines.push(`- User agent: ${device.userAgent}`);
  lines.push('');

  for (const section of SECTION_ORDER) {
    const checks = byStatus(report.checks, section.status);
    if (checks.length === 0) continue;

    lines.push(`## ${section.title} (${checks.length})`);
    lines.push('');

    // Detail for the things that need acting on; a one-line roll-up for the
    // rest, so the document stays scannable rather than exhaustive everywhere.
    const detailed = section.status === 'fail' || section.status === 'warn';
    for (const check of checks) {
      if (!detailed) {
        lines.push(`- **${check.title}** — ${check.summary}`);
        continue;
      }

      lines.push(`### ${check.title}`);
      lines.push('');
      lines.push(check.summary);
      lines.push('');
      if (check.measurements.length) {
        lines.push('| Measurement | Value | Graded against |');
        lines.push('| --- | --- | --- |');
        for (const item of check.measurements) {
          lines.push(`| ${item.label} | ${item.value} | ${item.against ?? '—'} |`);
        }
        lines.push('');
      }
      if (check.evidence.length) {
        for (const line of check.evidence) lines.push(`- ${line}`);
        lines.push('');
      }
      if (check.remediation) {
        lines.push(`**What to do:** ${check.remediation}`);
        lines.push('');
      }
      lines.push(
        `_${CONFIDENCE_LABELS[check.confidence]} — ${check.confidenceReason}${
          check.actionable ? '' : ' This cause is outside the app.'
        }_`,
      );
      lines.push('');
    }
    lines.push('');
  }

  const { window } = report;

  if (window.scripts.length) {
    lines.push('## Scripts during the run');
    lines.push('');
    lines.push('| Function | Source | Time | Calls | Forced layout |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const script of window.scripts.slice(0, 10)) {
      lines.push(
        `| ${script.fn} | ${script.source} | ${script.totalMs.toFixed(0)}ms | ${script.count} | ${script.forcedLayoutMs.toFixed(0)}ms |`,
      );
    }
    lines.push('');
  }

  if (window.zeroQueries.length) {
    lines.push('## Data requests during the run');
    lines.push('');
    lines.push('| Query | Calls | p50 | p95 | Max | Failures |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const row of window.zeroQueries.slice(0, 10)) {
      lines.push(
        `| ${row.name} | ${row.count} | ${row.p50Ms.toFixed(0)}ms | ${row.p95Ms.toFixed(0)}ms | ${row.maxMs.toFixed(0)}ms | ${row.errors} |`,
      );
    }
    lines.push('');
  }

  if (window.api.length) {
    lines.push('## Server requests during the run');
    lines.push('');
    lines.push('| Endpoint | Calls | p95 | Total | Transferred |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of window.api.slice(0, 10)) {
      lines.push(
        `| ${row.endpoint} | ${row.count} | ${row.p95Ms.toFixed(0)}ms | ${row.totalMs.toFixed(0)}ms | ${row.transferKb.toFixed(0)} KB |`,
      );
    }
    lines.push('');
  }

  if (window.processes.length) {
    lines.push('## Processes during the run');
    lines.push('');
    lines.push('| Process | Average CPU | Peak CPU | Memory | Wake-ups/s |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of window.processes.slice(0, 10)) {
      lines.push(
        `| ${row.name} (${row.type}) | ${row.avgCpuPercent.toFixed(1)}% | ${row.peakCpuPercent.toFixed(1)}% | ${row.avgWorkingSetMb.toFixed(0)} MB | ${row.peakIdleWakeupsPerSecond.toFixed(0)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildRunJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}

/** HTML for the channel post an automation watches. */
export function buildRunChannelHtml(report: RunReport): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines: string[] = [];

  lines.push(
    `<p><strong>Diagnostic run — ${escape(CHECK_STATUS_STYLES[report.overall].label)}</strong></p>`,
  );
  lines.push(`<p>${escape(report.headline)}</p>`);

  const notable = [...byStatus(report.checks, 'fail'), ...byStatus(report.checks, 'warn')];
  if (notable.length) {
    lines.push('<ul>');
    for (const check of notable.slice(0, 8)) {
      const measurements = check.measurements
        .slice(0, 2)
        .map(item => `${item.label} ${item.value}`)
        .join(', ');
      lines.push(
        `<li><strong>${escape(check.title)}</strong>: ${escape(check.summary)}${
          measurements ? ` — ${escape(measurements)}` : ''
        } <em>(${escape(CONFIDENCE_LABELS[check.confidence])})</em></li>`,
      );
    }
    lines.push('</ul>');
  }

  lines.push('<p><strong>For investigation</strong></p><ul>');
  lines.push(`<li>Observed: ${seconds(report.window.durationMs)} on ${escape(report.route)}</li>`);
  lines.push(`<li>Platform: ${escape(report.device.platform)}</li>`);
  if (report.device.appVersion) {
    lines.push(`<li>App version: ${escape(report.device.appVersion)}</li>`);
  }
  if (report.device.deviceId) {
    lines.push(`<li>service_instance_id: ${escape(report.device.deviceId)}</li>`);
  }
  if (report.probes.cpu) {
    lines.push(
      `<li>Machine speed: ${Math.round(report.probes.cpu.speedIndex * 100)}% of reference</li>`,
    );
  }
  lines.push(`<li>Run at: ${new Date(report.startedAt).toISOString()}</li>`);
  lines.push('</ul>');

  return lines.join('');
}

/**
 * Prompt for the opt-in Ask AI handoff.
 *
 * The run itself never calls a model — every verdict below was already decided
 * on-device. This exists only because a user may then want to ask about the
 * result, so it carries the findings and the working rather than raw telemetry
 * for something else to interpret from scratch.
 */
export function buildRunAskAiPrompt(report: RunReport): string {
  const lines: string[] = [];

  lines.push(
    'I ran the built-in performance diagnostics. Can you explain this and what I should do?',
  );
  lines.push('');
  lines.push(
    `Result: ${CHECK_STATUS_STYLES[report.overall].label}. ${report.headline} Measured over ${seconds(report.window.durationMs)} on ${report.route}, while the app was ${report.interactedDuringRun ? 'in use' : 'idle'}.`,
  );

  const notable = [...byStatus(report.checks, 'fail'), ...byStatus(report.checks, 'warn')];
  if (notable.length) {
    lines.push('');
    lines.push('What it found:');
    for (const check of notable.slice(0, 8)) {
      const measurements = check.measurements
        .slice(0, 3)
        .map(item => `${item.label} ${item.value}`)
        .join(', ');
      lines.push(
        `- ${check.title}: ${check.summary}${measurements ? ` (${measurements})` : ''} [${CONFIDENCE_LABELS[check.confidence].toLowerCase()}${check.actionable ? '' : '; cause is outside the app'}]`,
      );
    }
  }

  const skipped = byStatus(report.checks, 'skipped');
  if (skipped.length) {
    lines.push('');
    lines.push(
      `Not measured: ${skipped.map(check => check.title.toLowerCase()).join(', ')} — so these are unknown rather than healthy.`,
    );
  }

  if (report.probes.cpu) {
    lines.push('');
    lines.push(
      `This machine benchmarks at ${Math.round(report.probes.cpu.speedIndex * 100)}% of reference speed with ${report.device.hardwareConcurrency ?? 'unknown'} cores.`,
    );
  }

  const worstScript = report.window.scripts[0];
  if (worstScript) {
    lines.push(
      `Heaviest script during the run: ${worstScript.fn} in ${worstScript.source}, ${worstScript.totalMs.toFixed(0)}ms over ${worstScript.count} call(s).`,
    );
  }

  lines.push('');
  lines.push(
    `Device: ${report.device.platform}${report.device.appVersion ? `, app ${report.device.appVersion}` : ''}.`,
  );
  if (report.device.deviceId) {
    lines.push(
      `If you can query client telemetry, my events are in the logging bridge under service_instance_id ${report.device.deviceId}.`,
    );
  }

  return lines.join('\n');
}
