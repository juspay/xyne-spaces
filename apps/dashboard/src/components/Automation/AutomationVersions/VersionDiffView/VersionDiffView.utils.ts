import { CONDITIONAL_STEP_TYPE, SWITCH_STEP_TYPE } from '../../Automation.types';
import type {
  AutomationConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
} from '../../Automation.types';
import {
  SCHEDULE_DIFF_KEY,
  TRIGGER_CONFIG_DIFF_KEY,
  TRIGGER_DIFF_KEY,
  TRIGGER_TYPE_DIFF_KEY,
  type DiffMark,
} from '../../AutomationBuilder/DiffHighlight/DiffHighlight';
import {
  getBranchSteps,
  listBranchKeys,
} from '../../AutomationBuilder/FlowAutomationView/FlowAutomationView.utils';

interface VersionDiff {
  /** Marks for the older version's pane: removed, changed, moved. */
  olderMarks: Map<string, DiffMark>;
  /** Marks for the newer version's pane: added, changed, moved. */
  newerMarks: Map<string, DiffMark>;
  counts: Record<DiffMark, number>;
}

/** One-line summary, e.g. "2 changed · 1 added · name changed", or "No differences". */
export function summarizeDiff(counts: Record<DiffMark, number>, otherChanges: string[]): string {
  const parts = (['changed', 'added', 'removed', 'moved'] as const)
    .filter(mark => counts[mark] > 0)
    .map(mark => `${counts[mark]} ${mark}`);
  if (otherChanges.length) parts.push(`${otherChanges.join(', ')} changed`);
  return parts.length ? parts.join(' · ') : 'No differences';
}

/** JSON with object keys sorted, so key order never reads as a change. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/** A step without its branches — nested steps are compared on their own. */
function ownContent(step: AutomationStepConfig): unknown {
  if (step.type === CONDITIONAL_STEP_TYPE) {
    const config: Record<string, unknown> = { ...(step as ConditionalStepConfig).config };
    delete config['if_true'];
    delete config['if_false'];
    return { type: step.type, config };
  }
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    const config: Record<string, unknown> = {
      ...sw.config,
      cases: sw.config.cases.map(c => {
        const rest: Record<string, unknown> = { ...c };
        delete rest['steps'];
        return rest;
      }),
    };
    delete config['default'];
    return { type: step.type, config };
  }
  return step;
}

interface FlatStep {
  content: string;
  /** `root`, or the owning step's id plus branch key. */
  container: string;
  index: number;
}

function flattenSteps(
  steps: AutomationStepConfig[],
  container: string,
  out: Map<string, FlatStep>,
): Map<string, FlatStep> {
  steps.forEach((step, index) => {
    out.set(step.id, { content: stableStringify(ownContent(step)), container, index });
    for (const branchKey of listBranchKeys(step)) {
      flattenSteps(getBranchSteps(step, branchKey), `${step.id}/${branchKey}`, out);
    }
  });
  return out;
}

/**
 * Steps (from `ids`, kept in the same container by both versions) whose order
 * changed. Per container, the longest run that kept its relative order stays
 * put and everything else is "moved" — so a swap marks one step, not its
 * neighbours, and inserting or removing a step marks nothing.
 */
function reorderedIds(
  older: Map<string, FlatStep>,
  newer: Map<string, FlatStep>,
  ids: Set<string>,
): Set<string> {
  const byContainer = new Map<string, [string, FlatStep][]>();
  for (const entry of newer) {
    if (!ids.has(entry[0])) continue;
    const group = byContainer.get(entry[1].container) ?? [];
    group.push(entry);
    byContainer.set(entry[1].container, group);
  }

  const moved = new Set<string>();
  for (const group of byContainer.values()) {
    group.sort(([, a], [, b]) => a.index - b.index);
    const olderIndex = group.map(([id]) => older.get(id)?.index ?? 0);
    // Longest increasing subsequence of the older indices, O(n²) — branches are short.
    const length = olderIndex.map(() => 1);
    const previous = olderIndex.map(() => -1);
    let best = 0;
    for (let i = 0; i < olderIndex.length; i++) {
      for (let j = 0; j < i; j++) {
        if (olderIndex[j]! < olderIndex[i]! && length[j]! + 1 > length[i]!) {
          length[i] = length[j]! + 1;
          previous[i] = j;
        }
      }
      if (length[i]! > length[best]!) best = i;
    }
    const kept = new Set<number>();
    for (let i = group.length ? best : -1; i !== -1; i = previous[i]!) kept.add(i);
    group.forEach(([id], i) => {
      if (!kept.has(i)) moved.add(id);
    });
  }
  return moved;
}

/** "Run immediately" is stored both as `{ type: 'IMMEDIATE' }` and as no schedule. */
function normalizedSchedule(config: AutomationConfig): unknown {
  return config.schedule?.type === 'SCHEDULED' ? config.schedule : null;
}

/**
 * Step-level diff between two versions of one automation. Steps are matched by
 * id, which a proposed change keeps from the version it started from.
 */
export function computeVersionDiff(older: AutomationConfig, newer: AutomationConfig): VersionDiff {
  const olderMarks = new Map<string, DiffMark>();
  const newerMarks = new Map<string, DiffMark>();
  const counts: Record<DiffMark, number> = { added: 0, removed: 0, changed: 0, moved: 0 };

  const markSection = (key: string, mark: DiffMark): void => {
    olderMarks.set(key, mark);
    newerMarks.set(key, mark);
  };
  const markBoth = (key: string, mark: DiffMark): void => {
    markSection(key, mark);
    counts[mark] += 1;
  };

  if (stableStringify(older.trigger) !== stableStringify(newer.trigger)) {
    markBoth(TRIGGER_DIFF_KEY, 'changed');
    if (older.trigger.type !== newer.trigger.type) markSection(TRIGGER_TYPE_DIFF_KEY, 'changed');
    if (stableStringify(older.trigger.config) !== stableStringify(newer.trigger.config)) {
      markSection(TRIGGER_CONFIG_DIFF_KEY, 'changed');
    }
  }
  if (stableStringify(normalizedSchedule(older)) !== stableStringify(normalizedSchedule(newer))) {
    markBoth(SCHEDULE_DIFF_KEY, 'changed');
  }

  const olderSteps = flattenSteps(older.steps, 'root', new Map());
  const newerSteps = flattenSteps(newer.steps, 'root', new Map());
  const sameContainer = new Set<string>();
  for (const [id, step] of olderSteps) {
    if (newerSteps.get(id)?.container === step.container) sameContainer.add(id);
  }
  const reordered = reorderedIds(olderSteps, newerSteps, sameContainer);

  for (const [id, before] of olderSteps) {
    const after = newerSteps.get(id);
    if (!after) {
      olderMarks.set(id, 'removed');
      counts.removed += 1;
    } else if (before.content !== after.content) {
      markBoth(id, 'changed');
    } else if (!sameContainer.has(id) || reordered.has(id)) {
      markBoth(id, 'moved');
    }
  }
  for (const id of newerSteps.keys()) {
    if (!olderSteps.has(id)) {
      newerMarks.set(id, 'added');
      counts.added += 1;
    }
  }

  return { olderMarks, newerMarks, counts };
}
