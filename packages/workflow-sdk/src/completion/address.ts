/**
 * Finding the node a delivery is for, without touching storage.
 *
 * Pure so the whole outcome matrix is a table test: the runtime reads the rows
 * and the config, this decides.
 */

import { leafStepId } from '../engine/node-path.js';
import type { StepRecord } from '../persistence/types.js';
import type { Address, DeliveryOutcome } from './types.js';

const PARKED: ReadonlySet<string> = new Set(['EXTERNAL_WAIT', 'REVIEW_WAIT']);
const OVER: ReadonlySet<string> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export type Resolution =
  | { readonly kind: 'gate'; readonly row: StepRecord }
  | { readonly kind: 'outcome'; readonly outcome: DeliveryOutcome };

/**
 * Every step id the config mentions.
 *
 * A generic scan for `{ id, type }` rather than a walk of each control step's
 * branches: the shape of a branch is the step's business, and over-collecting
 * only costs a `not_ready` where `unknown` would have been — the safe
 * direction, since a sender retries one and gives up on the other.
 */
export function collectStepIds(config: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(config)) {
    for (const item of config) collectStepIds(item, into);
    return into;
  }
  if (config !== null && typeof config === 'object') {
    const node = config as Record<string, unknown>;
    if (typeof node['id'] === 'string' && typeof node['type'] === 'string') into.add(node['id']);
    for (const value of Object.values(node)) collectStepIds(value, into);
  }
  return into;
}

/** The parked node an address names, or why there is none. */
export function resolveGate(
  address: Address,
  executionStatus: string,
  rows: readonly StepRecord[],
  knownStepIds: ReadonlySet<string>,
): Resolution {
  const no = (outcome: DeliveryOutcome): Resolution => ({ kind: 'outcome', outcome });

  if (OVER.has(executionStatus)) return no({ kind: 'ignored', reason: 'run_ended' });

  const named = rows.filter((row) => leafStepId(row.stepName) === address.stepId);
  const parked = named.filter((row) => PARKED.has(row.status));

  if (address.nodePath !== undefined) {
    const exact = parked.find((row) => row.stepName === address.nodePath);
    if (exact) return { kind: 'gate', row: exact };
    // Named a node that is not open: it answered already, or never existed.
    return no(
      rows.some((row) => row.stepName === address.nodePath)
        ? { kind: 'ignored', reason: 'already_answered' }
        : { kind: 'unknown' },
    );
  }

  if (parked.length === 1) return { kind: 'gate', row: parked[0]! };
  if (parked.length > 1) {
    return no({ kind: 'ambiguous', nodePaths: parked.map((row) => row.stepName) });
  }
  // The step ran and moved on, so its answer is already in.
  if (named.length > 0) return no({ kind: 'ignored', reason: 'already_answered' });
  // Not parked and never recorded: either the run has not reached it, or there
  // is no such step. Only the config can tell those apart, and the difference
  // decides whether the sender should try again.
  return no(knownStepIds.has(address.stepId) ? { kind: 'not_ready' } : { kind: 'unknown' });
}
