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

/* eslint-disable no-console -- this module IS the console tracer; every statement
   below is gated behind `enabled`, which is false in production builds. */

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
  // `step` is passed as an argument, not interpolated: it carries message text
  // (intent.worker.ts embeds the winning segment), so a message containing %c or
  // %s would consume the style arguments and shift the whole line.
  if (data === undefined) {
    console.log(`%c[intent:${scope}]%c %s`, STYLE_SCOPE, STYLE_STEP, step);
  } else {
    console.log(`%c[intent:${scope}]%c %s`, STYLE_SCOPE, STYLE_STEP, step, data);
  }
}

export function traceTable(scope: 'main' | 'worker', step: string, rows: unknown[]): void {
  if (!enabled) return;
  console.log(`%c[intent:${scope}]%c %s`, STYLE_SCOPE, STYLE_STEP, step);
  console.table(rows);
}
