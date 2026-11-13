/**
 * Reading a stored config, with the one mapping it needs.
 *
 * `WAIT` keeps its id and is now exactly the human gate it was always used as.
 * Its other two modes became their own steps, and neither could ever resume —
 * delay because nothing re-enqueued at its deadline, webhook because its route
 * was never mounted — so a config that used one has never run. Mapped here, at
 * every point the engine reads a config, rather than by rewriting rows.
 */

import { BuiltinStepType } from '../types/known-types.js';
import type { WorkflowConfig } from '../types/workflow-config.js';

export function readWorkflowConfig(raw: string | null): WorkflowConfig {
  const config = JSON.parse(raw ?? '{}') as WorkflowConfig;
  migrateWaits(config);
  return config;
}

/**
 * A generic walk for `{ id, type: 'WAIT' }`, rather than one that knows each
 * control step's branch keys — the shape of a branch is that step's business.
 */
function migrateWaits(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) migrateWaits(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const step = node as Record<string, unknown>;
  if (step['type'] === 'WAIT' && typeof step['id'] === 'string') split(step);
  for (const value of Object.values(step)) migrateWaits(value);
}

function split(step: Record<string, unknown>): void {
  const config = (step['config'] ?? {}) as Record<string, unknown>;

  if (config['mode'] === 'delay') {
    step['type'] = BuiltinStepType.DELAY;
    step['config'] = { afterMs: config['delayMs'] };
    return;
  }
  if (config['mode'] === 'webhook') {
    // There is no payload contract to carry over: the mode never delivered one.
    step['type'] = BuiltinStepType.WAIT_FOR_WEBHOOK;
    step['config'] = {};
    return;
  }
  // Approval, or no mode at all: already the human gate. Left exactly as it is,
  // `mode` and all — an unknown key, which the schema ignores.
}
