import type { RunReport } from './types';

/**
 * Keeps the last few runs so the panel opens on the previous result rather than
 * an empty screen, and so two runs can be compared — "it was fine an hour ago"
 * is only checkable if the earlier report still exists.
 */

const STORAGE_KEY = 'xyne-diagnostics-runs';
const MAX_REPORTS = 5;

/**
 * Raw per-sample arrays are dropped before storing. Everything the panel and the
 * export show is already derived from them by the time a run finishes, and
 * keeping tens of thousands of points would put a run's worth of raw telemetry
 * into local storage for no further use.
 */
function trim(report: RunReport): RunReport {
  return {
    ...report,
    window: {
      ...report.window,
      samples: {},
      longTasks: [],
    },
  };
}

export function loadReports(): RunReport[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReport);
  } catch {
    return [];
  }
}

export function saveReport(report: RunReport): RunReport[] {
  const reports = [
    trim(report),
    ...loadReports().filter(existing => existing.id !== report.id),
  ].slice(0, MAX_REPORTS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch {
    // Storage full or blocked. The run itself is unaffected — it is already in
    // memory and on screen — so this must not surface as a failure.
  }
  return reports;
}

export function clearReports(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; the caller clears its in-memory copy regardless.
  }
}

function isReport(value: unknown): value is RunReport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RunReport>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.startedAt === 'number' &&
    Array.isArray(candidate.checks)
  );
}
