/**
 * Control-construct iterations from raw execution records.
 *
 * Both MAP (concurrent items) and LOOP (sequential passes) run one body N times,
 * recording each pass under a node-path frame `<ctrlId>:<branchKey>#<i>/<rest>`
 * (MAP → branchKey `item`, LOOP → `body`). This module groups those records into
 * per-iteration buckets — the shared source of truth behind the graph's MAP lanes
 * and the Journey's iteration folders. The grouping is branch-key-agnostic, so it
 * serves any such construct.
 */

import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import { buildStepStatesFromRecords, type StepExecutionState } from './step-state.js';

/** One iteration of a control construct, ready to render as its own lane/folder. */
export interface ControlIteration {
  /** Zero-based iteration index, as captured from the node-path. */
  index: number;
  /** Per-iteration step states, keyed by bare leaf config id. */
  states: Map<string, StepExecutionState>;
  /** This iteration's frame-stripped records — fed to a nested construct in the body. */
  records: ExecutionDetail['steps'];
  /**
   * The node-path frame for this iteration (e.g. `owners_map:item#0/`). Prefixed
   * onto a body step's id to form a per-iteration selection id, so the same step
   * in different iterations selects DIFFERENT records.
   */
  prefix: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Group an execution's raw step records into per-iteration buckets for one control
 * step. Two views per iteration:
 *   - `states`: built from the records AS-IS, so each record's `nodePath` stays the
 *     FULL node-path — what the approvals selector / sidebar resume need to resume a
 *     paused gate inside one iteration. (Keying is by bare leaf id via `leafStepId`,
 *     so there's no cross-iteration collision regardless.)
 *   - `records`: the same records with the `<ctrlId>:<branchKey>#<i>/` frame
 *     stripped, so a nested construct in the body can regex-match its own iterations
 *     against paths relative to this iteration.
 *
 * Returned sorted by index so they render in source-array / pass order.
 */
export function buildIterations(
  ctrlId: string,
  records: ExecutionDetail['steps'] | undefined,
): ControlIteration[] {
  if (!records) return [];
  const re = new RegExp(`^${escapeRegExp(ctrlId)}:[^/]+#(\\d+)/`);
  const full = new Map<number, ExecutionDetail['steps']>();
  const stripped = new Map<number, ExecutionDetail['steps']>();

  for (const r of records) {
    const m = re.exec(r.stepName);
    if (!m) continue;
    const iter = Number(m[1]);
    (full.get(iter) ?? full.set(iter, []).get(iter)!).push(r);
    const sub = r.stepName.slice(r.stepName.indexOf('/') + 1); // drop the iteration frame
    (stripped.get(iter) ?? stripped.set(iter, []).get(iter)!).push({ ...r, stepName: sub });
  }

  return [...full.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, recs]) => {
      const first = recs![0]!.stepName;
      return {
        index,
        records: stripped.get(index)!,
        states: buildStepStatesFromRecords(recs),
        prefix: first.slice(0, first.indexOf('/') + 1), // e.g. "owners_map:item#0/"
      };
    });
}

/**
 * index → source item value (when a string) from a control step's output record,
 * for labelling iterations. Handles MAP (`output.items[{index,item}]`) and LOOP
 * (`output.results[]`, positional).
 */
export function iterationItemValues(
  records: ExecutionDetail['steps'] | undefined,
  ctrlId: string,
): Record<number, string> {
  const rec = records?.find((s) => s.stepName === ctrlId);
  if (!rec?.data) return {};
  try {
    const out = (JSON.parse(rec.data) as {
      output?: { items?: Array<{ index: number; item: unknown }>; results?: unknown[] };
    }).output;
    const m: Record<number, string> = {};
    for (const it of out?.items ?? []) if (typeof it.item === 'string') m[it.index] = it.item;
    if (out?.results) out.results.forEach((v, i) => { if (typeof v === 'string' && m[i] === undefined) m[i] = v; });
    return m;
  } catch {
    return {};
  }
}
