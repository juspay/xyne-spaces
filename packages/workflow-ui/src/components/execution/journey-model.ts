import type { WorkflowStepConfig, StepGroup } from '@xyne/workflow-sdk/builder';
import type { StepMeta } from '../../hooks/use-step-metadata.js';
import type { StepExecutionState } from '../../utils/step-state.js';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import { detectBranchesFromConfig } from '../../utils/branch-detection.js';
import { buildIterations, iterationItemValues } from '../../utils/iterations.js';

/**
 * Shared execution-hierarchy model for the Journey and Tabs views: resolves the
 * config + runtime records into a drillable level model (sections, rows,
 * breadcrumb) with resolved if-blocks inlined and MAP/LOOP iterations as folders.
 * Pure logic only — no JSX — so both view shells consume the same structure.
 */

export type Status = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped';

export interface Section {
  label?: string | undefined;
  steps: WorkflowStepConfig[];
  /** Per-level state source (a MAP iteration's states); falls back to the global stepStates. */
  states?: Map<string, StepExecutionState> | undefined;
  /** Node-path frame prefixed onto a step's id for selection (MAP iteration); default ''. */
  selectionPrefix?: string | undefined;
  /** Present only at a MAP-construct level — the runtime iterations to list as folders. */
  iterations?: IterationView[] | undefined;
}
/** One iteration of a MAP/LOOP construct as a drillable Journey folder. */
export interface IterationView {
  ctrlId: string;
  index: number;
  label: string;
  states: Map<string, StepExecutionState>;
  prefix: string;
  bodySteps: WorkflowStepConfig[];
}
export interface Crumb { label: string }
export type Descriptor =
  | { kind: 'group'; id: string; label: string }
  | { kind: 'construct'; id: string; label: string }
  | { kind: 'iterationItem'; id: string; index: number; label: string };

export function branchesOf(step: WorkflowStepConfig, stepMeta: Map<string, StepMeta>) {
  if (!step.config || typeof step.config !== 'object') return {};
  return detectBranchesFromConfig(step.config as Record<string, unknown>, stepMeta.get(step.type)?.configSchema);
}

export function branchSections(step: WorkflowStepConfig, stepMeta: Map<string, StepMeta>): Section[] {
  const entries = Object.values(branchesOf(step, stepMeta));
  if (stepMeta.get(step.type)?.branchModel === 'iterate') {
    return [{ steps: entries[0]?.steps ?? [] }];
  }
  return entries.map((b) => ({ label: b.label, steps: b.steps }));
}

/** Whether a construct iterates a single body over runtime items (MAP concurrent, LOOP sequential). */
export function isIterating(branchModel: string | undefined): boolean {
  return branchModel === 'map' || branchModel === 'iterate';
}

/** Config body steps of a single-body iterating construct (MAP / LOOP). */
export function bodyStepsOf(step: WorkflowStepConfig, stepMeta: Map<string, StepMeta>): WorkflowStepConfig[] {
  return Object.values(branchesOf(step, stepMeta))[0]?.steps ?? [];
}

/** Runtime iterations of a MAP/LOOP step as drillable folders (empty before it runs). */
export function iterationViewsOf(
  step: WorkflowStepConfig,
  stepMeta: Map<string, StepMeta>,
  records: ExecutionDetail['steps'] | undefined,
): IterationView[] {
  const body = bodyStepsOf(step, stepMeta);
  const values = iterationItemValues(records, step.id);
  return buildIterations(step.id, records).map((it) => ({
    ctrlId: step.id,
    index: it.index,
    label: values[it.index] ? `Item ${String(it.index)} · ${values[it.index]!}` : `Item ${String(it.index)}`,
    states: it.states,
    prefix: it.prefix,
    bodySteps: body,
  }));
}

/** Worst-meaningful status across a subtree (recurses into branches). */
export function rollup(steps: WorkflowStepConfig[], states: Map<string, StepExecutionState>, stepMeta: Map<string, StepMeta>): Status {
  const acc: Status[] = [];
  const walk = (list: WorkflowStepConfig[]) => {
    for (const s of list) {
      const st = (states.get(s.id)?.status as Status) ?? 'pending';
      acc.push(st);
      // A step whose own status is terminal already reflects its whole subtree — don't
      // descend. Descending visits not-taken conditional branches, whose steps stay
      // pending forever; the canonical case is a gate that resolved to its empty
      // else-branch, leaving the if-branch's "hold" step pending — that lone pending
      // would otherwise drag a fully-completed group down to 'pending' and hide it.
      if (st === 'completed' || st === 'failed' || st === 'skipped') continue;
      // Live construct: follow the taken branch of a resolved if/switch, else all branches.
      const taken = takenBranch(s, stepMeta, states);
      if (taken) walk(taken);
      else for (const b of Object.values(branchesOf(s, stepMeta))) walk(b.steps);
    }
  };
  walk(steps);
  if (acc.some((s) => s === 'failed')) return 'failed';
  if (acc.some((s) => s === 'running')) return 'running';
  if (acc.some((s) => s === 'paused')) return 'paused';
  if (acc.length > 0 && acc.every((s) => s === 'completed' || s === 'skipped')) {
    return acc.every((s) => s === 'skipped') ? 'skipped' : 'completed';
  }
  return 'pending';
}

/**
 * The single ENTERED branch of a resolved exclusive construct (CONDITIONAL / SWITCH) —
 * the if-block to inline. Null for loops, parallels, not-yet-resolved (pending) constructs,
 * and non-constructs, which stay as drill-in folders.
 */
export function takenBranch(
  step: WorkflowStepConfig,
  stepMeta: Map<string, StepMeta>,
  states: Map<string, StepExecutionState>,
): WorkflowStepConfig[] | null {
  if (stepMeta.get(step.type)?.branchModel === 'iterate') return null; // loop
  const branches = branchesOf(step, stepMeta);
  const keys = Object.keys(branches);
  if (keys.length === 0) return null;                           // not a construct
  if (keys.some((k) => k.startsWith('branches.'))) return null; // parallel (all branches run)
  // "Entered" = a direct step of the branch has started — a SHALLOW check by design.
  // Using rollup() here recurses into the branch's OWN nested if-blocks, whose
  // not-taken (pending) sub-branches make a fully-run branch look pending; then no
  // branch qualifies and the whole subtree collapses to pending. A direct step's
  // status is the reliable "did control reach this branch" signal.
  const entered = Object.values(branches).filter((b) =>
    b.steps.some((s) => {
      const st = states.get(s.id)?.status;
      return st != null && st !== 'pending' && st !== 'skipped';
    }),
  );
  return entered.length === 1 ? entered[0]!.steps : null;       // exactly one taken → inline
}

/** Flatten resolved if-blocks in place (recursively) so drilling can still find nested constructs. */
export function effectiveSteps(
  steps: WorkflowStepConfig[],
  stepMeta: Map<string, StepMeta>,
  states: Map<string, StepExecutionState>,
): WorkflowStepConfig[] {
  const out: WorkflowStepConfig[] = [];
  for (const step of steps) {
    const inline = takenBranch(step, stepMeta, states);
    if (inline) out.push(...effectiveSteps(inline, stepMeta, states));
    else out.push(step);
  }
  return out;
}

/**
 * A group's members — descends through inlined (taken) if-block branches so a
 * group nested inside a resolved conditional is still found when drilled into.
 * A matching step is kept raw (not descended) so its own conditionals inline at display.
 *
 * Also descends the branches of always-run constructs (PARALLEL), where every branch
 * executes so every branch's steps are genuine members. Without this, a group whose
 * steps live inside a PARALLEL resolves to zero members and is dropped from the
 * sidebar entirely — pinned groups included. Mirrors rollup()'s branch walk.
 */
export function membersOfGroup(
  steps: WorkflowStepConfig[],
  groupId: string,
  stepMeta: Map<string, StepMeta>,
  states: Map<string, StepExecutionState>,
): WorkflowStepConfig[] {
  const out: WorkflowStepConfig[] = [];
  for (const s of steps) {
    if (s.groupId === groupId) { out.push(s); continue; }
    const taken = takenBranch(s, stepMeta, states);
    if (taken) out.push(...membersOfGroup(taken, groupId, stepMeta, states));
    else for (const b of Object.values(branchesOf(s, stepMeta))) out.push(...membersOfGroup(b.steps, groupId, stepMeta, states));
  }
  return out;
}

/** Resolve the current drill level (sections + breadcrumb) from the path by id. */
export function resolveLevel(
  rootSteps: WorkflowStepConfig[],
  stepMeta: Map<string, StepMeta>,
  path: Descriptor[],
  records: ExecutionDetail['steps'] | undefined,
  states: Map<string, StepExecutionState>,
): { sections: Section[]; crumbs: Crumb[]; insideGroupId: string | undefined } {
  let sections: Section[] = [{ steps: rootSteps }];
  const crumbs: Crumb[] = [{ label: 'Run' }];
  let insideGroupId: string | undefined;
  for (const d of path) {
    if (d.kind === 'group') {
      const members = membersOfGroup(sections.flatMap((s) => s.steps), d.id, stepMeta, states);
      if (members.length === 0) break;
      sections = [{ steps: members }];
      insideGroupId = d.id;
    } else if (d.kind === 'iterationItem') {
      // Drill into one MAP/LOOP iteration → its config body with that iteration's
      // states + node-path prefix. Rendering from here is identical to any level.
      const view = (sections[0]?.iterations ?? []).find((v) => v.index === d.index);
      if (!view) break;
      sections = [{ steps: view.bodySteps, states: view.states, selectionPrefix: view.prefix }];
      insideGroupId = undefined;
    } else {
      // Inline resolved if-blocks so a construct nested in a taken branch stays findable.
      const step = sections.flatMap((s) => effectiveSteps(s.steps, stepMeta, states)).find((s) => s.id === d.id);
      if (!step) break;
      if (isIterating(stepMeta.get(step.type)?.branchModel)) {
        // Drill into a MAP/LOOP → list its runtime iterations (empty pre-run → config body).
        const iterations = iterationViewsOf(step, stepMeta, records);
        sections = iterations.length > 0 ? [{ steps: [], iterations }] : branchSections(step, stepMeta);
      } else {
        // Plain construct: resolves its branches from config. NOTE: a construct
        // drilled from *inside* an iteration loses that iteration's prefix/states
        // (we resolve from root), so its sub-steps fall back to the aggregated bare-id
        // view — same known limitation as nested control in the graph. Flat bodies
        // (the common case) are unaffected.
        sections = branchSections(step, stepMeta);
      }
      insideGroupId = undefined;
    }
    crumbs.push({ label: d.label });
  }
  return { sections, crumbs, insideGroupId };
}

// ─── Row model ───

export type Row =
  | { kind: 'group'; group: StepGroup; members: WorkflowStepConfig[] }
  | { kind: 'construct'; step: WorkflowStepConfig; meta: StepMeta | undefined; branchCount: number }
  | { kind: 'leaf'; step: WorkflowStepConfig; meta: StepMeta | undefined }
  | { kind: 'iteration'; view: IterationView };

export function stepRow(step: WorkflowStepConfig, stepMeta: Map<string, StepMeta>): Row {
  const meta = stepMeta.get(step.type);
  const branchCount = Object.keys(branchesOf(step, stepMeta)).length;
  return branchCount > 0 ? { kind: 'construct', step, meta, branchCount } : { kind: 'leaf', step, meta };
}

/** A step's row(s): a resolved if-block inlines its taken branch (recursively); else a single row. */
export function rowsForStep(
  step: WorkflowStepConfig,
  groups: StepGroup[] | undefined,
  stepMeta: Map<string, StepMeta>,
  ignoreGroupId: string | undefined,
  states: Map<string, StepExecutionState>,
  hoistedGroupIds?: Set<string>,
): Row[] {
  const inline = takenBranch(step, stepMeta, states);
  return inline ? buildRows(inline, groups, stepMeta, ignoreGroupId, states, hoistedGroupIds) : [stepRow(step, stepMeta)];
}

export function buildRows(
  steps: WorkflowStepConfig[],
  groups: StepGroup[] | undefined,
  stepMeta: Map<string, StepMeta>,
  ignoreGroupId: string | undefined,
  states: Map<string, StepExecutionState>,
  hoistedGroupIds?: Set<string>,
): Row[] {
  const rows: Row[] = [];
  const emittedGroups = new Set<string>();
  let i = 0;
  while (i < steps.length) {
    const step = steps[i]!;
    const gid = step.groupId;
    const group = gid && gid !== ignoreGroupId ? groups?.find((g) => g.id === gid) : undefined;
    if (group && gid) {
      i++;
      // A group's steps can be non-contiguous in config order (another group interleaved).
      // Emit the group once — at its first member, with ALL its members — otherwise it
      // renders as duplicate folders, one per contiguous run.
      if (emittedGroups.has(gid)) continue;
      emittedGroups.add(gid);
      // A group hoisted to the top level (config `pinned`) is rendered there only — drop it
      // from every nested view so it isn't duplicated once it has "come outside".
      if (hoistedGroupIds?.has(gid)) continue;
      const members = membersOfGroup(steps, gid, stepMeta, states);
      // A single-member group adds no value as a folder — float the member up
      // so it's one click to its detail, not a drill into a one-item list.
      if (members.length === 1) rows.push(...rowsForStep(members[0]!, groups, stepMeta, ignoreGroupId, states, hoistedGroupIds));
      else rows.push({ kind: 'group', group, members });
    } else {
      rows.push(...rowsForStep(step, groups, stepMeta, ignoreGroupId, states, hoistedGroupIds));
      i++;
    }
  }
  // Hide not-yet-executed (pending) nodes — the views list only the executed path.
  return rows.filter((row) => {
    if (row.kind === 'iteration') return true;
    if (row.kind === 'group') return rollup(row.members, states, stepMeta) !== 'pending';
    const st = (states.get(row.step.id)?.status as Status)
      ?? (row.kind === 'construct' ? rollup([row.step], states, stepMeta) : 'pending');
    return st !== 'pending';
  });
}

export type LiveTarget = { path: Descriptor[]; stepId: string; status: Status; label: string };

/**
 * The deepest running/paused leaf in the DISPLAYED tree (paused preferred) — where
 * the run currently "is" — with the drill path to reach it. Null if nothing is active.
 */
export function findLivePath(
  steps: WorkflowStepConfig[],
  groups: StepGroup[] | undefined,
  stepMeta: Map<string, StepMeta>,
  states: Map<string, StepExecutionState>,
  ignoreGroupId: string | undefined,
  basePath: Descriptor[],
): LiveTarget | null {
  const rank = (s: Status): number => (s === 'paused' ? 2 : s === 'running' ? 1 : 0);
  let best: LiveTarget | null = null;
  const consider = (c: LiveTarget | null): void => {
    if (!c) return;
    const b = best;
    if (b === null || rank(c.status) > rank(b.status) || (rank(c.status) === rank(b.status) && c.path.length > b.path.length)) best = c;
  };
  for (const row of buildRows(steps, groups, stepMeta, ignoreGroupId, states)) {
    if (row.kind === 'leaf') {
      const st = (states.get(row.step.id)?.status as Status) ?? 'pending';
      if (st === 'paused' || st === 'running') {
        consider({ path: basePath, stepId: row.step.id, status: st, label: row.step.title || row.meta?.name || row.step.type });
      }
    } else if (row.kind === 'group') {
      const members = membersOfGroup(steps, row.group.id, stepMeta, states);
      consider(findLivePath(members, groups, stepMeta, states, row.group.id, [...basePath, { kind: 'group', id: row.group.id, label: row.group.title }]));
    } else if (row.kind === 'construct') {
      const label = row.step.title || row.meta?.name || row.step.type;
      for (const sec of branchSections(row.step, stepMeta)) {
        consider(findLivePath(sec.steps, groups, stepMeta, states, undefined, [...basePath, { kind: 'construct', id: row.step.id, label }]));
      }
    }
  }
  return best;
}

/** Tally each executable leaf's status across the active path (resolved if-blocks inlined). */
export function tallyLeaves(
  steps: WorkflowStepConfig[],
  stepMeta: Map<string, StepMeta>,
  states: Map<string, StepExecutionState>,
): Record<Status, number> {
  const counts: Record<Status, number> = { pending: 0, running: 0, completed: 0, failed: 0, paused: 0, skipped: 0 };
  for (const s of effectiveSteps(steps, stepMeta, states)) {
    const branches = Object.values(branchesOf(s, stepMeta));
    if (branches.length === 0) {
      counts[(states.get(s.id)?.status as Status) ?? 'pending'] += 1;
    } else {
      for (const b of branches) {
        const sub = tallyLeaves(b.steps, stepMeta, states);
        (Object.keys(counts) as Status[]).forEach((k) => { counts[k] += sub[k]; });
      }
    }
  }
  return counts;
}
