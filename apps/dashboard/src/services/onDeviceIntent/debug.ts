/**
 * Step-by-step console tracing for the on-device intent pipeline.
 *
 * Off in production unless explicitly enabled. Workers have no `localStorage`, so the
 * main thread resolves the flag and pushes it into the worker at init (SET_DEBUG) —
 * `resolveDebugEnabled()` is main-thread only, `setDebugEnabled()` is how the worker
 * receives it.
 *
 * Enable in any build from the console:
 *   localStorage.setItem('xyne:intent-debug', '1'); location.reload();
 */

const STORAGE_KEY = 'xyne:intent-debug';

const STYLE_SCOPE = 'color:#8b5cf6;font-weight:600';
const STYLE_STEP = 'color:#64748b';

let enabled = false;

/** Main thread only — reads the env and the localStorage override. */
export function resolveDebugEnabled(): boolean {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === '1') return true;
    if (window.localStorage.getItem(STORAGE_KEY) === '0') return false;
  } catch {
    // localStorage can throw in locked-down contexts — fall through to the env default.
  }
  return import.meta.env.DEV;
}

export function setDebugEnabled(value: boolean): void {
  enabled = value;
}

export function isDebugEnabled(): boolean {
  return enabled;
}

/**
 * `step` is the pipeline stage, so a filter on "[intent" in the console shows the whole
 * flow in order across both threads.
 */
export function trace(scope: 'main' | 'worker', step: string, data?: unknown): void {
  if (!enabled) return;
  if (data === undefined) {
    console.log(`%c[intent:${scope}]%c ${step}`, STYLE_SCOPE, STYLE_STEP);
  } else {
    console.log(`%c[intent:${scope}]%c ${step}`, STYLE_SCOPE, STYLE_STEP, data);
  }
}

export function traceTable(scope: 'main' | 'worker', step: string, rows: unknown[]): void {
  if (!enabled) return;
  console.log(`%c[intent:${scope}]%c ${step}`, STYLE_SCOPE, STYLE_STEP);
  console.table(rows);
}
