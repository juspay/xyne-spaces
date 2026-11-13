import type { ReactNode } from 'react';
import type { WorkflowStepConfig, StepGroup } from '@xyne/workflow-sdk/builder';

export interface GroupLayoutOptions {
  /** The steps at this level (top level or a single branch/loop sub-tree). */
  steps: WorkflowStepConfig[];
  /** All workflow groups (membership is by each step's `groupId`). */
  groups: StepGroup[];
  /**
   * Render the per-step elements for `steps`. `suppress` holds the ids of steps
   * whose trailing connector must be omitted — these are group lower-boundaries,
   * where the connector is re-emitted *outside* the box via
   * `renderBoundaryConnector`.
   */
  renderElements: (suppress: Set<string>) => ReactNode[];
  /** Render a group box wrapping `children` (a contiguous run of grouped steps). */
  renderGroup: (group: StepGroup, children: ReactNode[], key: string) => ReactNode;
  /** Render the connector emitted just below a group box (the suppressed boundary). */
  renderBoundaryConnector: (lastStepId: string, key: string) => ReactNode;
  /**
   * True inside branch/loop sub-trees, where the last step always has a trailing
   * connector — so a group ending the sub-tree still needs a boundary connector.
   */
  showTrailingAdd?: boolean | undefined;
}

/**
 * Wraps contiguous runs of steps sharing a `groupId` in group boxes, shared by
 * the builder (`WorkflowTree`) and run view (`ExecutionTree`). Pure layout: the
 * callers supply how to render the step elements, the group box, and the
 * boundary connector — this owns only the run-detection + connector-suppression
 * bookkeeping that both trees would otherwise duplicate.
 */
export function layoutStepsWithGroups(opts: GroupLayoutOptions): ReactNode[] {
  const { steps, groups, renderElements, renderGroup, renderBoundaryConnector, showTrailingAdd } = opts;

  const groupFor = (gid: string | undefined) => (gid ? groups.find((g) => g.id === gid) : undefined);

  // 1. Each group's last step must suppress its inner trailing connector so the
  //    connector can render outside the box (otherwise the "+" sits on the border).
  const suppress = new Set<string>();
  for (let k = 0; k < steps.length;) {
    const gid = steps[k]!.groupId;
    if (!groupFor(gid)) { k++; continue; }
    let end = k;
    while (end + 1 < steps.length && steps[end + 1]!.groupId === gid) end++;
    if (end < steps.length - 1 || showTrailingAdd) suppress.add(steps[end]!.id);
    k = end + 1;
  }

  // 2. Render elements with suppression, then assemble — wrapping group runs and
  //    re-emitting boundary connectors outside their boxes.
  const elements = renderElements(suppress);
  const out: ReactNode[] = [];
  for (let i = 0; i < steps.length;) {
    const gid = steps[i]!.groupId;
    const group = groupFor(gid);
    if (!group) { out.push(elements[i]); i++; continue; }

    const start = i;
    const run: ReactNode[] = [];
    while (i < steps.length && steps[i]!.groupId === gid) { run.push(elements[i]); i++; }
    const lastStep = steps[i - 1]!;

    out.push(renderGroup(group, run, `group-${group.id}-${start}`));
    if (suppress.has(lastStep.id)) {
      out.push(renderBoundaryConnector(lastStep.id, `group-conn-${group.id}-${start}`));
    }
  }
  return out;
}
