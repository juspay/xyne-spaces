import { SLOW_MACHINE_SPEED_INDEX } from '../probes/cpuBenchmark';
import { RESPONSIVENESS_CHECKS } from './responsiveness';
import { SYNC_CHECKS } from './sync';
import { SYSTEM_CHECKS } from './system';
import { statusRank, worstStatus, type CheckContext } from './shared';
import type { CpuContext, DeviceInfo } from '../../types';
import type { CheckResult, CheckStatus, ProbeResults, WindowSummary } from '../types';

export type { CheckContext } from './shared';

/** The machine is loaded above this, in absolute terms. */
const SYSTEM_BUSY_PERCENT = 70;
/** Below this share of that load, Xyne is a bystander to it rather than its cause. */
const BYSTANDER_SHARE = 25;

const ALL_CHECKS = [...RESPONSIVENESS_CHECKS, ...SYNC_CHECKS, ...SYSTEM_CHECKS];

export function buildCheckContext(options: {
  window: WindowSummary;
  probes: ProbeResults;
  cpu: CpuContext;
  device: DeviceInfo;
  zeroObserved: boolean;
}): CheckContext {
  const { window, probes, cpu, device, zeroObserved } = options;

  const machineIsSlow = (probes.cpu?.speedIndex ?? 1) < SLOW_MACHINE_SPEED_INDEX;

  // Deliberately narrow. Hardware merely being slow never excuses an app-side
  // fault — only positive evidence that someone *else* is using the machine,
  // or that it is thermally throttled, is grounds for calling a finding
  // unactionable.
  const busyElsewhere =
    cpu.systemCpuPercent !== null &&
    cpu.appSharePercent !== null &&
    cpu.systemCpuPercent >= SYSTEM_BUSY_PERCENT &&
    cpu.appSharePercent < BYSTANDER_SHARE;
  const throttled = Boolean(cpu.thermalState && cpu.thermalState !== 'nominal');

  return {
    window,
    probes,
    cpu,
    device,
    machineIsSlow,
    loadIsExternal: busyElsewhere || throttled,
    interactive: window.interactions > 0,
    zeroObserved,
  };
}

/**
 * Runs every check. A check that throws is reported as inconclusive rather than
 * taking the run down with it — a diagnostic tool that fails to produce a report
 * when something is unusual has failed at the one moment it was needed.
 */
export function runChecks(context: CheckContext): CheckResult[] {
  const results: CheckResult[] = [];

  for (const [index, check] of ALL_CHECKS.entries()) {
    try {
      const result = check(context);
      if (result) results.push(result);
    } catch (error) {
      results.push({
        id: `check-error-${index}`,
        title: 'A check could not complete',
        category: 'machine',
        status: 'inconclusive',
        confidence: 'low',
        confidenceReason: 'The check failed before producing a result.',
        summary: 'One diagnostic check failed to run.',
        measurements: [],
        evidence: [error instanceof Error ? error.message : String(error)],
        remediation: '',
        actionable: false,
      });
    }
  }

  return sortChecks(results);
}

/**
 * Worst first, and within a status the things the reader can act on before the
 * things they cannot. A finding about someone else's machine load is context,
 * not a task.
 */
export function sortChecks(checks: CheckResult[]): CheckResult[] {
  return [...checks].sort((a, b) => {
    const byStatus = statusRank(b.status) - statusRank(a.status);
    if (byStatus !== 0) return byStatus;
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export function overallStatus(checks: CheckResult[]): CheckStatus {
  const graded = checks
    .map(check => check.status)
    .filter(status => status === 'pass' || status === 'warn' || status === 'fail');
  return graded.length === 0 ? 'inconclusive' : worstStatus(graded);
}

export function headlineFor(checks: CheckResult[], overall: CheckStatus): string {
  const failures = checks.filter(check => check.status === 'fail');
  const warnings = checks.filter(check => check.status === 'warn');
  const assessed = checks.filter(check => check.status !== 'skipped').length;

  if (overall === 'fail') {
    const first = failures[0];
    return failures.length === 1
      ? `1 problem found: ${first?.title.toLowerCase()}.`
      : `${failures.length} problems found, starting with ${first?.title.toLowerCase()}.`;
  }
  if (overall === 'warn') {
    const first = warnings[0];
    return warnings.length === 1
      ? `1 thing needs attention: ${first?.title.toLowerCase()}.`
      : `${warnings.length} things need attention, starting with ${first?.title.toLowerCase()}.`;
  }
  if (overall === 'pass') {
    return `No problems found across ${assessed} checks.`;
  }
  return 'Not enough was measured to reach a conclusion. Try a longer run while reproducing the problem.';
}
