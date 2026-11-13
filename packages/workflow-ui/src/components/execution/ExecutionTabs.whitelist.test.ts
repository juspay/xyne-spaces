import { describe, it, expect } from 'vitest';
import type { WorkflowStepConfig, StepGroup } from '@xyne/workflow-sdk/builder';
import { pinnedRootRows, firstLeafOfLevel } from './ExecutionTabs.js';
import type { Section } from './journey-model.js';
import type { StepMeta } from '../../hooks/use-step-metadata.js';
import type { StepExecutionState } from '../../utils/step-state.js';

// A leaf step type — no branches, so stepRow() classifies members as 'leaf'.
const META = new Map<string, StepMeta>([
  ['CODE', { name: 'Code', category: 'logic', kind: 'action' }],
]);
const step = (id: string, groupId?: string): WorkflowStepConfig =>
  ({ id, type: 'CODE', title: id, ...(groupId ? { groupId } : {}) }) as WorkflowStepConfig;
const done = (ids: string[]): Map<string, StepExecutionState> =>
  new Map(ids.map((id) => [id, { stepName: id, stepType: 'CODE', status: 'completed' } as StepExecutionState]));

// Two plumbing groups + one pinned output group holding a single cumulative node.
const GROUPS: StepGroup[] = [
  { id: 'intake', title: 'Intake' },
  { id: 'sections', title: 'Sections' },
  { id: 'output', title: 'Cumulative CAM', pinned: true },
];
const STEPS = [step('read_cma', 'intake'), step('sec_I', 'sections'), step('assemble', 'output')];
const SECTIONS: Section[] = [{ steps: STEPS }];
const STATES = done(['read_cma', 'sec_I', 'assemble']);

describe('pinned-whitelist sidebar', () => {
  it('pinnedRootRows returns ONLY pinned groups, and a single-member pinned group is a leaf row', () => {
    const rows = pinnedRootRows(GROUPS, new Set(['output']), STEPS, META, STATES);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.g.id).toBe('output');
    expect(rows[0]!.kind).toBe('leaf');
    if (rows[0]!.kind === 'leaf') expect(rows[0]!.member.id).toBe('assemble');
  });

  it('a multi-member pinned group stays a drillable folder', () => {
    const steps = [step('assemble', 'output'), step('render', 'output')];
    const rows = pinnedRootRows(GROUPS, new Set(['output']), steps, META, done(['assemble', 'render']));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('group');
  });

  it('firstLeafOfLevel in whitelist mode auto-opens the pinned leaf, never a hidden node', () => {
    const first = firstLeafOfLevel(SECTIONS, GROUPS, META, undefined, STATES, new Set(['output']), true);
    expect(first).toEqual({ id: 'assemble', label: 'Cumulative CAM' });
  });

  it('firstLeafOfLevel without whitelist falls back to the first section leaf (read_cma)', () => {
    const first = firstLeafOfLevel(SECTIONS, GROUPS, META, undefined, STATES, new Set(['output']), false);
    // hoisted 'output' is dropped from the normal rows; the first non-pinned leaf wins.
    expect(first?.id).toBe('read_cma');
  });

  it('whitelist mode opens the pinned leaf even while it is still pending (fills in live)', () => {
    const first = firstLeafOfLevel(SECTIONS, GROUPS, META, undefined, done(['read_cma', 'sec_I']), new Set(['output']), true);
    expect(first).toEqual({ id: 'assemble', label: 'Cumulative CAM' });
  });

  it('whitelist mode with only a multi-member pinned group opens nothing (user drills in)', () => {
    const steps = [step('assemble', 'output'), step('render', 'output')];
    const sections: Section[] = [{ steps }];
    const first = firstLeafOfLevel(sections, GROUPS, META, undefined, done(['assemble', 'render']), new Set(['output']), true);
    expect(first).toBeNull();
  });
});
