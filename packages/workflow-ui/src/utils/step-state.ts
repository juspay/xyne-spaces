/**
 * Step-execution state model — the shared vocabulary the whole execution view is
 * built on. Pure (no React): types + functions that turn raw `ExecutionDetail`
 * step records (node-path keyed) into per-step UI state.
 *
 * Lives here (not in the viewer hook) because every surface depends on it — the
 * graph (`ExecutionTree`/`MapContainer`), the Journey, the detail panel, and the
 * iteration grouping (`utils/iterations.ts`). Keeping it in `utils` also avoids a
 * util→hook dependency.
 */

import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import type { PauseState } from '@xyne/workflow-sdk';
import { leafStepId } from '@xyne/workflow-sdk/common';
import type { WorkflowStepConfig } from '@xyne/workflow-sdk/builder';

// ─── Types ───

export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped';

export interface StepExecutionState {
  stepName: string;
  stepType: string;
  status: StepExecutionStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  duration?: number;
  pauseState?: PauseState;
  /**
   * Full node-path record key of the underlying step (e.g.
   * `parallel_x:swot#0/gate`). `stepName` is reduced to the bare config id for
   * graph/timeline matching; this retains the precise key needed to resume a
   * specific gate. When several records collapse to one id, this is the paused
   * one's path (paused outranks the rest in aggregation).
   */
  nodePath?: string;
}

// ─── Raw status → UI status ───

export function mapStepStatus(rawStatus: string): StepExecutionStatus {
  switch (rawStatus) {
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'RUNNING': return 'running';
    case 'PAUSED':
    case 'EXTERNAL_WAIT':
    case 'REVIEW_WAIT': return 'paused';
    case 'SKIPPED': return 'skipped';
    default: return 'pending';
  }
}

// ─── Aggregation (many records → one bare id) ───

/**
 * Aggregation precedence when several records collapse to the same bare step id
 * (a LOOP body step across iterations, or same-id steps in different branches —
 * one config node, many records). The most attention-worthy status wins.
 */
const STATUS_RANK: Record<StepExecutionStatus, number> = {
  running: 5, paused: 4, failed: 3, completed: 2, skipped: 1, pending: 0,
};

/** Merge two states for the same bare step id, keeping the higher-ranked status. */
export function aggregateStepState(a: StepExecutionState, b: StepExecutionState): StepExecutionState {
  const winner = STATUS_RANK[b.status] >= STATUS_RANK[a.status] ? b : a;
  const loser = winner === b ? a : b;
  const merged: StepExecutionState = {
    stepName: winner.stepName,
    stepType: winner.stepType || loser.stepType,
    status: winner.status,
  };
  const input = winner.input ?? loser.input;
  if (input) merged.input = input;
  const output = winner.output ?? loser.output;
  if (output) merged.output = output;
  const error = winner.error ?? loser.error;
  if (error) merged.error = error;
  // Prefer a pauseState from whichever record is actually paused.
  const pauseState = winner.pauseState ?? loser.pauseState;
  if (pauseState) merged.pauseState = pauseState;
  // Keep the winner's node-path (the paused record's, since paused outranks) so
  // resume can target the right gate.
  const nodePath = winner.nodePath ?? loser.nodePath;
  if (nodePath) merged.nodePath = nodePath;
  return merged;
}

// ─── Records → states ───

/**
 * Build step states map from execution detail's step rows, keyed by the BARE
 * config step id so it matches graph nodes and SSE events.
 *
 * Step records are keyed by node-path (`ctrl:branch#iter/.../stepId` for nested
 * steps; bare id for top-level). We reduce each to its leaf config id via
 * `leafStepId`. Multiple records can collapse to one id (a LOOP body across
 * iterations, or same-id steps in sibling branches) — those are aggregated by
 * status precedence (see `aggregateStepState`).
 *
 * `synthesizeNestedStates` then fills states for nested steps that have NOT yet
 * produced a record (e.g. children of a still-running control step), inheriting
 * the parent's status — a fallback for in-progress visualization only.
 */
export function buildStepStates(detail: ExecutionDetail): Map<string, StepExecutionState> {
  return buildStepStatesFromRecords(detail.steps ?? [], detail.config?.steps);
}

/**
 * Build a step-states map from a set of raw step records (keyed by bare leaf
 * config id, aggregated by status precedence). `buildStepStates` passes the
 * whole execution; iteration lanes pass one iteration's frame-stripped records
 * so each lane gets its own per-iteration states.
 */
export function buildStepStatesFromRecords(
  records: ExecutionDetail['steps'],
  configSteps?: WorkflowStepConfig[],
): Map<string, StepExecutionState> {
  const map = new Map<string, StepExecutionState>();
  if (!records) return map;

  // ─── LEGACY (safe to remove once no pre-id-keying executions remain) ─────────
  // Older executor builds keyed TOP-LEVEL records positionally (`step_0`,
  // `step_1`, …) instead of by the config step's `id`. The current executor keys
  // every record by `step.id` / node-path (nothing writes `step_N` anymore — see
  // workflow-executor.ts emitting `stepName: step.id`), so this map only joins
  // history persisted before that switch. It is viewer-only — it never affects
  // execution/resume — but dropping it makes those old records render orphaned
  // (their steps show as pending). NOTE: it maps by POSITION, so it mis-joins if
  // the config was reordered after the run.
  //
  // TO REMOVE: delete this `stepKeyMap` block AND drop the `stepKeyMap.get(...) ??`
  // prefix on the `bareId` line below (leaving just `leafStepId(step.stepName)`).
  // Only do this once no in-flight/browsable execution can still carry `step_N`
  // records. Then `configSteps` is used solely by `synthesizeNestedStates`.
  const stepKeyMap = new Map<string, string>();
  if (configSteps) {
    for (let i = 0; i < configSteps.length; i++) {
      stepKeyMap.set(`step_${i}`, configSteps[i]!.id);
    }
  }
  // ─── end LEGACY ──────────────────────────────────────────────────────────────

  for (const step of records) {
    let stepData: Record<string, unknown> | undefined;
    if (step.data) {
      try {
        stepData = JSON.parse(step.data) as Record<string, unknown>;
      } catch {
        // Ignore parse errors
      }
    }

    // Record keys are node-path qualified for nested steps and bare config ids
    // for top-level steps. Reduce to the bare config id so they match graph
    // nodes / SSE events. `stepKeyMap.get(...)` is the LEGACY `step_N` fallback
    // (see block above) — remove it with that block; keep `leafStepId(...)`.
    const bareId = stepKeyMap.get(step.stepName) ?? leafStepId(step.stepName);

    const incoming: StepExecutionState = {
      stepName: bareId,
      stepType: step.executorType,
      status: mapStepStatus(step.status),
    };
    const input = stepData?.['input'] as Record<string, unknown> | undefined;
    if (input) incoming.input = input;
    const output = stepData?.['output'] as Record<string, unknown> | undefined;
    if (output) incoming.output = output;
    const err = stepData?.['error'] as string | undefined;
    if (err) incoming.error = err;
    const pauseStateRaw = stepData?.['pauseState'] as PauseState | undefined;
    if (pauseStateRaw) incoming.pauseState = pauseStateRaw;
    // Retain the full record key so a paused gate can be resumed precisely.
    incoming.nodePath = step.stepName;

    // Many records can collapse to one bare id (loop iterations / same-id branch
    // steps) — aggregate by status precedence rather than last-write-wins.
    const existing = map.get(bareId);
    map.set(bareId, existing ? aggregateStepState(existing, incoming) : incoming);
  }

  // Synthesize states for nested steps (branch sub-steps, loop bodies, etc.)
  if (configSteps) {
    synthesizeNestedStates(configSteps, map);
  }

  return map;
}

/**
 * Recursively walk config steps and synthesize execution states for
 * nested steps that the executor doesn't emit as separate rows.
 *
 * Works at any depth: parallel → loop → parallel → … etc.
 * If a parent step has a known state, its children inherit accordingly.
 * For PARALLEL branches we also inspect the per-branch result to
 * distinguish fulfilled vs rejected sub-steps and attach output to
 * the last step in each branch.
 */
function synthesizeNestedStates(
  steps: WorkflowStepConfig[],
  map: Map<string, StepExecutionState>,
  inheritedStatus?: StepExecutionStatus,
): void {
  for (const step of steps) {
    const state = map.get(step.id);
    const effectiveStatus = state?.status ?? inheritedStatus;

    const cfg = step.config as Record<string, unknown> | undefined;
    if (!cfg) continue;

    // ─── Multi-branch containers (PARALLEL, CONDITIONAL, etc.) ───
    const branches = cfg['branches'];
    if (branches && typeof branches === 'object' && !Array.isArray(branches)) {
      // Per-branch results from the parent's output (allSettled shape)
      const outputBranches = (state?.output as Record<string, unknown> | undefined)?.['branches'] as
        Record<string, { status?: string; value?: unknown }> | undefined;

      for (const [branchName, branchSteps] of Object.entries(branches as Record<string, unknown>)) {
        if (!Array.isArray(branchSteps)) continue;
        const typed = branchSteps as WorkflowStepConfig[];
        const branchResult = outputBranches?.[branchName];

        for (let i = 0; i < typed.length; i++) {
          const sub = typed[i]!;
          if (!map.has(sub.id) && effectiveStatus) {
            const synth: StepExecutionStatus | undefined =
              effectiveStatus === 'completed'
                ? (branchResult?.status === 'rejected' ? 'failed' : 'completed')
                : effectiveStatus === 'running' ? 'running'
                : effectiveStatus === 'failed' ? 'failed'
                : undefined;

            if (synth) {
              const subState: StepExecutionState = {
                stepName: sub.id,
                stepType: sub.type,
                status: synth,
              };
              // Attach branch value as the last step's output
              if (synth === 'completed' && i === typed.length - 1 && branchResult?.value) {
                subState.output = branchResult.value as Record<string, unknown>;
              }
              map.set(sub.id, subState);
            }
          }
        }

        // Recurse into branch steps for deeper nesting
        synthesizeNestedStates(typed, map, effectiveStatus);
      }
    }

    // ─── Single-branch containers (LOOP, etc.) ───
    const body = cfg['body'];
    if (Array.isArray(body)) {
      const bodySteps = body as WorkflowStepConfig[];

      for (const sub of bodySteps) {
        if (!map.has(sub.id) && effectiveStatus) {
          const synth: StepExecutionStatus | undefined =
            effectiveStatus === 'completed' ? 'completed'
              : effectiveStatus === 'running' ? 'running'
              : effectiveStatus === 'failed' ? 'failed'
              : undefined;

          if (synth) {
            map.set(sub.id, {
              stepName: sub.id,
              stepType: sub.type,
              status: synth,
            });
          }
        }
      }

      // Recurse into body steps for deeper nesting
      synthesizeNestedStates(bodySteps, map, effectiveStatus);
    }
  }
}

// ─── Incremental patch (live SSE updates) ───

/**
 * Upsert one node-path record in `execution.steps` from an incremental SSE event.
 * Finds the record by `nodePath` (exact node-path key, e.g. `map1:item#0/validate`;
 * equals the bare id for top-level steps) and merges the new `status` + `data`
 * fields; appends a fresh record if this is the step's first event. Returns a new
 * detail object (or the same one if there's no execution yet) so React re-renders
 * and the derived `stepStates` / iteration lanes pick up the change.
 */
export function patchExecutionStep(
  detail: ExecutionDetail | undefined,
  nodePath: string,
  patch: { status?: string; executorType?: string; dataMerge?: Record<string, unknown> },
): ExecutionDetail | undefined {
  if (!detail) return detail; // events before the first snapshot are a no-op
  const steps = (detail.steps ?? []) as ExecutionDetail['steps'];
  const idx = steps.findIndex((s) => s.stepName === nodePath);
  const prev = idx >= 0 ? steps[idx]! : undefined;

  let data: Record<string, unknown> = {};
  if (prev?.data) {
    try { data = JSON.parse(prev.data) as Record<string, unknown>; } catch { /* keep {} */ }
  }
  if (patch.dataMerge) data = { ...data, ...patch.dataMerge };

  const nextRecord = {
    ...(prev ?? { stepName: nodePath, executorType: patch.executorType ?? '' }),
    stepName: nodePath,
    status: patch.status ?? prev?.status ?? 'RUNNING',
    data: JSON.stringify(data),
  } as ExecutionDetail['steps'][number];

  const nextSteps =
    idx >= 0 ? steps.map((s, i) => (i === idx ? nextRecord : s)) : [...steps, nextRecord];
  return { ...detail, steps: nextSteps };
}
