import { describe, expect, it } from 'vitest';
import type { AutomationConfig, StepCatalogItem, ValidationIssue } from '../../Automation.types';
import {
  META_CONDITIONS_ID,
  META_TRIGGER_ID,
  buildAutomationGraph,
  buildAutomationGraphModel,
  countTriggerFilters,
  layoutKey,
} from './automationGraph.layout';

const catalog: StepCatalogItem[] = [
  {
    type: 'SEND_MESSAGE',
    name: 'Send message',
    description: 'Post a message to a channel',
    category: 'Messaging',
    kind: 'ACTION',
  },
];

const leaf = { variable: '{{context.trigger.output.priority}}', operator: 'eq', value: 'P0' };

function build(
  config: AutomationConfig,
  opts: { editMode?: boolean; issues?: ValidationIssue[] } = {},
) {
  return buildAutomationGraphModel({
    config,
    stepCatalog: catalog,
    triggerSchema: null,
    issues: opts.issues,
    editMode: opts.editMode ?? false,
  });
}

const issue = (path: string): ValidationIssue => ({ path, code: 'shape', message: 'bad' });

const base = (steps: AutomationConfig['steps'] = []): AutomationConfig => ({
  trigger: { type: 'TICKET_CREATED', config: {} },
  steps,
});

const edgeBetween = (edges: { source: string; target: string }[], s: string, t: string) =>
  edges.find(e => e.source === s && e.target === t);

describe('buildAutomationGraphModel', () => {
  it('renders the trigger → timing → conditions spine for an empty automation', () => {
    const { nodes, edges } = build(base());
    expect(nodes.map(n => n.data.kind)).toEqual(['trigger', 'schedule', 'conditions']);
    expect(edges).toHaveLength(2);
    expect(nodes.find(n => n.id === META_CONDITIONS_ID)?.data.title).toBe('No filters');
  });

  it('adds "+" insertion nodes only in edit mode', () => {
    const cfg = base([{ id: 'a', type: 'SEND_MESSAGE', config: {} }]);
    expect(build(cfg).nodes.some(n => n.data.kind === 'add')).toBe(false);
    const edit = build(cfg, { editMode: true }).nodes.filter(n => n.data.kind === 'add');
    expect(edit.map(n => n.data.insertAt)).toEqual([0, 1]);
  });

  it('names actions from the catalog and numbers top-level steps', () => {
    const { nodes } = build(base([{ id: 'a', type: 'SEND_MESSAGE', config: {} }]));
    const step = nodes.find(n => n.id === 'step:a');
    expect(step?.data.title).toBe('Send message');
    expect(step?.data.kicker).toBe('Step 1 · Messaging');
    expect(step?.data.rootStepId).toBe('a');
  });

  it('labels conditional arms and rejoins them before the next step', () => {
    const { nodes, edges } = build(
      base([
        {
          id: 'c',
          type: 'CONDITIONAL',
          config: {
            condition: leaf,
            if_true: [{ id: 't1', type: 'SEND_MESSAGE', config: {} }],
            if_false: [],
          },
        },
        { id: 'after', type: 'SEND_MESSAGE', config: {} },
      ]),
    );
    expect(nodes.find(n => n.id === 'step:c')?.data.title).toBe('If trigger.priority equals "P0"');
    expect(edgeBetween(edges, 'step:c', 'step:t1')).toMatchObject({ label: 'True' });
    expect(edgeBetween(edges, 'step:c', 'step:c:empty:false')).toMatchObject({ label: 'False' });
    // Both arms reconverge and the next step hangs off the join, not the If node.
    expect(edgeBetween(edges, 'step:t1', 'step:c:join')).toBeDefined();
    expect(edgeBetween(edges, 'step:c:empty:false', 'step:c:join')).toBeDefined();
    expect(edgeBetween(edges, 'step:c:join', 'step:after')).toBeDefined();
    expect(edgeBetween(edges, 'step:c', 'step:after')).toBeUndefined();
    // Nested nodes resolve to their root step for the editor.
    expect(nodes.find(n => n.id === 'step:t1')?.data.rootStepId).toBe('c');
  });

  it('keeps ids unique when switch case labels repeat', () => {
    const { nodes, edges } = build(
      base([
        {
          id: 's',
          type: 'SWITCH',
          config: {
            cases: [
              { condition: leaf, label: 'Urgent', steps: [] },
              { condition: leaf, label: 'Urgent', steps: [] },
            ],
            default: [],
          },
        },
      ]),
    );
    const ids = nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const edgeIds = edges.map(e => e.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
    expect(edges.filter(e => e.source === 'step:s').map(e => e.label)).toEqual([
      'Urgent',
      'Urgent',
      'Default',
    ]);
  });

  it('attributes validation issues to the node that owns them', () => {
    const cfg = base([
      {
        id: 'c',
        type: 'CONDITIONAL',
        config: {
          condition: leaf,
          if_true: [{ id: 't1', type: 'SEND_MESSAGE', config: {} }],
        },
      },
    ]);
    const { nodes } = build(cfg, {
      issues: [
        issue('trigger.type'),
        issue('trigger.config.priority'),
        issue('steps[0].config.condition.value'),
        issue('steps[0].config.if_true[0].config.channelId'),
      ],
    });
    const count = (id: string) => nodes.find(n => n.id === id)?.data.issueCount;
    expect(count(META_TRIGGER_ID)).toBe(1);
    expect(count(META_CONDITIONS_ID)).toBe(1);
    expect(count('step:c')).toBe(1);
    expect(count('step:t1')).toBe(1);
  });

  it('only relayouts when structure changes', () => {
    const cfg = base([{ id: 'a', type: 'SEND_MESSAGE', config: {} }]);
    const a = build(cfg);
    const b = build({ ...cfg, steps: [{ id: 'a', type: 'SEND_MESSAGE', config: { text: 'hi' } }] });
    expect(layoutKey(a.nodes, a.edges)).toBe(layoutKey(b.nodes, b.edges));
    const c = build(base([...cfg.steps, { id: 'b', type: 'SEND_MESSAGE', config: {} }]));
    expect(layoutKey(a.nodes, a.edges)).not.toBe(layoutKey(c.nodes, c.edges));
  });
});

describe('countTriggerFilters', () => {
  it('ignores empty values and the derived formFieldIds key', () => {
    expect(
      countTriggerFilters({
        priority: ['P0'],
        boardId: '',
        tags: [],
        formFieldConditions: [{ id: 'f' }],
        formFieldIds: ['f'],
      }),
    ).toBe(2);
  });
});

describe('buildAutomationGraph', () => {
  it('positions every node top-to-bottom along the spine', () => {
    const { nodes } = buildAutomationGraph({
      config: base([{ id: 'a', type: 'SEND_MESSAGE', config: {} }]),
      stepCatalog: catalog,
      triggerSchema: null,
      issues: undefined,
      editMode: false,
    });
    const y = (id: string) => nodes.find(n => n.id === id)!.position.y;
    expect(y(META_TRIGGER_ID)).toBeLessThan(y(META_CONDITIONS_ID));
    expect(y(META_CONDITIONS_ID)).toBeLessThan(y('step:a'));
  });
});
