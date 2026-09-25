import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import {
  CONDITIONAL_STEP_TYPE,
  SWITCH_STEP_TYPE,
  type ActionStepConfig,
  type AutomationConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type StepCatalogItem,
  type SwitchStepConfig,
  type ValidationIssue,
} from '../../Automation.types';
import { summarizeCondition } from '../ConditionEditor/ConditionEditor.utils';
import {
  AUTO_NODE_TYPE,
  stepGraphId,
  type AutoNodeData,
  type AutoNodeKind,
  type BuildGraphArgs,
} from './automationGraph.types';

export const NODE_WIDTH = 272;
export const NODE_HEIGHT = 84;
const ADD_SIZE = 32;
const JOIN_SIZE = 12;

export type AutoNode = Node<AutoNodeData>;

export const META_TRIGGER_ID = 'meta:trigger';
export const META_SCHEDULE_ID = 'meta:schedule';
export const META_CONDITIONS_ID = 'meta:conditions';

export function nodeSize(kind: AutoNodeKind): { width: number; height: number } {
  if (kind === 'add') return { width: ADD_SIZE, height: ADD_SIZE };
  if (kind === 'join') return { width: JOIN_SIZE, height: JOIN_SIZE };
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

const isUnder = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);

const countUnder = (issues: ValidationIssue[] | undefined, prefix: string): number =>
  issues?.filter(i => isUnder(i.path, prefix)).length ?? 0;

/** Paths of a control step that belong to nested child steps (they get their own nodes). */
const NESTED_STEP_PATH = /\.config\.(?:if_true|if_false|default|cases\[\d+\]\.steps)\[/;

/** Issues on a control-flow step itself (its condition/cases), excluding nested steps. */
const countOwnControlIssues = (issues: ValidationIssue[] | undefined, path: string): number =>
  issues?.filter(i => isUnder(i.path, path) && !NESTED_STEP_PATH.test(i.path.slice(path.length)))
    .length ?? 0;

/**
 * Trigger issues split between the two trigger nodes: `trigger.config.*` is what
 * the Conditions node edits; everything else (e.g. `trigger.type`) is the event.
 */
const countTriggerEventIssues = (issues: ValidationIssue[] | undefined): number =>
  issues?.filter(i => isUnder(i.path, 'trigger') && !isUnder(i.path, 'trigger.config')).length ?? 0;

const isMeaningful = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

/** Number of trigger filters the user has actually set (derived keys excluded). */
export function countTriggerFilters(config: Record<string, unknown> | undefined): number {
  if (!config) return 0;
  return Object.entries(config).filter(
    // `formFieldIds` is a projection of `formFieldConditions`, not a separate filter.
    ([key, value]) => key !== 'formFieldIds' && isMeaningful(value),
  ).length;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function scheduleSubtitle(config: AutomationConfig): string {
  const s = config.schedule;
  if (!s || s.type === 'IMMEDIATE') return 'Runs as soon as the event fires';
  const unit = s.offset.amount === 1 ? s.offset.unit.replace(/s$/, '') : s.offset.unit;
  return `Waits ${s.offset.amount} ${unit} after ${s.field || 'a date field'}`;
}

interface Ctx {
  nodes: AutoNode[];
  edges: Edge[];
  catalog: StepCatalogItem[];
  issues: ValidationIssue[] | undefined;
  editMode: boolean;
}

function node(ctx: Ctx, id: string, data: AutoNodeData): void {
  ctx.nodes.push({ id, type: AUTO_NODE_TYPE, position: { x: 0, y: 0 }, data });
}

function edge(ctx: Ctx, source: string, target: string, label?: string): void {
  ctx.edges.push({
    id: `e:${source}->${target}`,
    source,
    target,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    className: label
      ? 'automation-graph-edge automation-graph-edge--branch'
      : 'automation-graph-edge',
    ...(label
      ? {
          label,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
        }
      : {}),
  });
}

interface Branch {
  /** Position-based key: unique even when user-facing labels repeat. */
  key: string;
  label: string;
  steps: AutomationStepConfig[];
  path: string;
}

/**
 * Lays out one arm of a control-flow step as a vertical chain hanging off its
 * parent. Returns the id of the arm's last node so the caller can reconverge
 * all arms into a single join point.
 */
function layoutBranch(
  ctx: Ctx,
  parentId: string,
  branch: Branch,
  rootStepId: string,
  depth: number,
): string {
  if (branch.steps.length === 0) {
    const emptyId = `${parentId}:empty:${branch.key}`;
    node(ctx, emptyId, {
      kind: 'branchEmpty',
      rootStepId,
      kicker: branch.label,
      title: 'No steps',
      subtitle: ctx.editMode ? 'Open to add steps to this branch' : 'Nothing runs on this path',
      depth,
      issueCount: 0,
      interactive: true,
    });
    edge(ctx, parentId, emptyId, branch.label);
    return emptyId;
  }
  let prev = parentId;
  branch.steps.forEach((step, i) => {
    const id = stepGraphId(step);
    const exit = addStepNode(ctx, step, id, rootStepId, depth, `${branch.path}[${i}]`, null);
    edge(ctx, prev, id, i === 0 ? branch.label : undefined);
    prev = exit;
  });
  return prev;
}

/**
 * Emits the node for a single step and, for control-flow steps, its branches
 * plus a join node. Returns the id the NEXT step should connect from — the
 * step itself for actions, the join node for control flow — so execution
 * visibly continues after the branches rather than as another arm.
 */
function addStepNode(
  ctx: Ctx,
  step: AutomationStepConfig,
  id: string,
  rootStepId: string,
  depth: number,
  path: string,
  stepNumber: number | null,
): string {
  const numberKicker = (label: string): string =>
    stepNumber === null ? label : `Step ${stepNumber} · ${label}`;

  if (step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE) {
    const branches: Branch[] = [];
    if (step.type === CONDITIONAL_STEP_TYPE) {
      const cond = step as ConditionalStepConfig;
      const t = cond.config.if_true ?? [];
      const f = cond.config.if_false ?? [];
      node(ctx, id, {
        kind: 'conditional',
        rootStepId,
        kicker: numberKicker('If / else'),
        title: `If ${summarizeCondition(cond.config.condition)}`,
        subtitle: `${plural(t.length, 'step')} if true · ${plural(f.length, 'step')} if false`,
        depth,
        issueCount: countOwnControlIssues(ctx.issues, path),
        interactive: true,
      });
      branches.push(
        { key: 'true', label: 'True', steps: t, path: `${path}.config.if_true` },
        { key: 'false', label: 'False', steps: f, path: `${path}.config.if_false` },
      );
    } else {
      const sw = step as SwitchStepConfig;
      const cases = sw.config.cases ?? [];
      node(ctx, id, {
        kind: 'switch',
        rootStepId,
        kicker: numberKicker('Switch'),
        title: 'Route by first matching case',
        subtitle: `${plural(cases.length, 'case')} + default`,
        depth,
        issueCount: countOwnControlIssues(ctx.issues, path),
        interactive: true,
      });
      cases.forEach((c, i) =>
        branches.push({
          key: `case-${i}`,
          label: c.label?.trim() || `Case ${i + 1}`,
          steps: c.steps ?? [],
          path: `${path}.config.cases[${i}].steps`,
        }),
      );
      branches.push({
        key: 'default',
        label: 'Default',
        steps: sw.config.default ?? [],
        path: `${path}.config.default`,
      });
    }
    const joinId = `${id}:join`;
    const tails = branches.map(b => layoutBranch(ctx, id, b, rootStepId, depth + 1));
    node(ctx, joinId, {
      kind: 'join',
      rootStepId,
      kicker: '',
      title: 'Branches rejoin',
      depth,
      issueCount: 0,
      interactive: false,
    });
    tails.forEach(tail => edge(ctx, tail, joinId));
    return joinId;
  }

  const action = step as ActionStepConfig;
  const item = ctx.catalog.find(c => c.type === action.type);
  node(ctx, id, {
    kind: 'action',
    rootStepId,
    kicker: numberKicker(item?.category || 'Action'),
    title: item?.name ?? (action.type || 'Unknown step'),
    ...(item?.description ? { subtitle: item.description } : {}),
    depth,
    issueCount: countUnder(ctx.issues, path),
    interactive: true,
  });
  return id;
}

/**
 * Builds the node/edge model for an automation WITHOUT positions. The main
 * spine is Trigger → Timing → Conditions → step0 → … with inline "+" add
 * affordances between top-level steps in edit mode. Pure and cheap: safe to
 * run on every keystroke.
 */
export function buildAutomationGraphModel(args: BuildGraphArgs): {
  nodes: AutoNode[];
  edges: Edge[];
} {
  const ctx: Ctx = {
    nodes: [],
    edges: [],
    catalog: args.stepCatalog,
    issues: args.issues,
    editMode: args.editMode,
  };
  const { config } = args;

  const hasTrigger = !!config.trigger.type;
  node(ctx, META_TRIGGER_ID, {
    kind: 'trigger',
    kicker: 'Trigger',
    title: hasTrigger ? (args.triggerSchema?.name ?? config.trigger.type) : 'Choose a trigger',
    subtitle: hasTrigger
      ? (args.triggerSchema?.description ?? 'Starts this automation')
      : 'Pick the event that starts this automation',
    depth: 0,
    issueCount: countTriggerEventIssues(args.issues),
    interactive: true,
  });
  node(ctx, META_SCHEDULE_ID, {
    kind: 'schedule',
    kicker: 'Timing',
    title: config.schedule?.type === 'SCHEDULED' ? 'Delayed run' : 'Run immediately',
    subtitle: scheduleSubtitle(config),
    depth: 0,
    issueCount: countUnder(args.issues, 'schedule'),
    interactive: true,
  });
  const filterCount = countTriggerFilters(config.trigger.config);
  node(ctx, META_CONDITIONS_ID, {
    kind: 'conditions',
    kicker: 'Conditions',
    title: filterCount > 0 ? `${plural(filterCount, 'filter')} applied` : 'No filters',
    subtitle: filterCount > 0 ? 'Runs only when every filter matches' : 'Runs on every event',
    depth: 0,
    issueCount: countUnder(args.issues, 'trigger.config'),
    interactive: true,
  });
  edge(ctx, META_TRIGGER_ID, META_SCHEDULE_ID);
  edge(ctx, META_SCHEDULE_ID, META_CONDITIONS_ID);

  let spinePrev = META_CONDITIONS_ID;

  const addSpineAdd = (insertAt: number): void => {
    if (!args.editMode) return;
    const id = `add:${insertAt}`;
    node(ctx, id, {
      kind: 'add',
      kicker: '',
      title: 'Add step',
      depth: 0,
      issueCount: 0,
      insertAt,
      interactive: false,
    });
    edge(ctx, spinePrev, id);
    spinePrev = id;
  };

  config.steps.forEach((step, index) => {
    addSpineAdd(index);
    const id = stepGraphId(step);
    const exit = addStepNode(ctx, step, id, step.id, 0, `steps[${index}]`, index + 1);
    edge(ctx, spinePrev, id);
    spinePrev = exit;
  });
  addSpineAdd(config.steps.length);

  return { nodes: ctx.nodes, edges: ctx.edges };
}

/**
 * Structural fingerprint of a model: only ids and kinds affect dagre output,
 * so text edits (titles, subtitles, issue counts) can reuse cached positions.
 */
export function layoutKey(nodes: AutoNode[], edges: Edge[]): string {
  return `${nodes.map(n => `${n.id}#${n.data.kind}`).join('|')}::${edges.map(e => e.id).join('|')}`;
}

/** Top-to-bottom dagre layout. Returns top-left positions keyed by node id. */
export function computeLayout(
  nodes: AutoNode[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 48, marginx: 32, marginy: 32 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, nodeSize(n.data.kind));
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  // dagre ships loose types; the graph builder is typed as Graph<any>.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    const { width, height } = nodeSize(n.data.kind);
    positions.set(n.id, { x: (pos?.x ?? 0) - width / 2, y: (pos?.y ?? 0) - height / 2 });
  }
  return positions;
}

export function applyLayout(
  nodes: AutoNode[],
  positions: Map<string, { x: number; y: number }>,
): AutoNode[] {
  return nodes.map(n => ({ ...n, position: positions.get(n.id) ?? n.position }));
}

/** Model + layout in one call. */
export function buildAutomationGraph(args: BuildGraphArgs): {
  nodes: AutoNode[];
  edges: Edge[];
} {
  const model = buildAutomationGraphModel(args);
  return {
    nodes: applyLayout(model.nodes, computeLayout(model.nodes, model.edges)),
    edges: model.edges,
  };
}
