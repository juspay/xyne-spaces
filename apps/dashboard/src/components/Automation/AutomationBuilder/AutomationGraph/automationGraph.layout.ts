import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import {
  CONDITIONAL_STEP_TYPE,
  SWITCH_STEP_TYPE,
  type ActionStepConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type StepCatalogItem,
  type SwitchStepConfig,
} from '../../Automation.types';
import {
  AUTO_NODE_TYPE,
  stepGraphId,
  type AutoNodeData,
  type BuildGraphArgs,
} from './automationGraph.types';

export const NODE_WIDTH = 264;
export const NODE_HEIGHT = 78;
const ADD_SIZE = 40;

type AutoNode = Node<AutoNodeData>;

const catalogName = (catalog: StepCatalogItem[], type: string): string =>
  catalog.find(c => c.type === type)?.name ?? type;

const catalogCategory = (catalog: StepCatalogItem[], type: string): string | undefined =>
  catalog.find(c => c.type === type)?.category;

/** True when the validation set has any issue whose path sits under `prefix`. */
const hasIssueUnder = (issues: BuildGraphArgs['issues'], prefix: string): boolean =>
  !!issues?.some(
    i => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`),
  );

interface Ctx {
  nodes: AutoNode[];
  edges: Edge[];
  catalog: StepCatalogItem[];
  issues: BuildGraphArgs['issues'];
  editMode: boolean;
}

function node(ctx: Ctx, id: string, data: AutoNodeData): void {
  ctx.nodes.push({ id, type: AUTO_NODE_TYPE, position: { x: 0, y: 0 }, data });
}

function edge(
  ctx: Ctx,
  source: string,
  target: string,
  opts?: { label?: string; branch?: boolean },
): void {
  ctx.edges.push({
    id: `${source}->${target}${opts?.label ? `:${opts.label}` : ''}`,
    source,
    target,
    type: 'smoothstep',
    ...(opts?.label ? { label: opts.label } : {}),
    ...(opts?.branch ? { animated: false } : {}),
    data: { branch: opts?.branch ?? false },
  });
}

/**
 * Lays out a nested branch (the `if_true` / `if_false` / case / default arms of
 * a control-flow step) as a vertical chain hanging off its parent node. Nested
 * nodes are click-to-edit but delegate to the owning top-level card in the
 * drawer, so `rootIndex` is threaded down unchanged.
 */
function layoutBranch(
  ctx: Ctx,
  parentId: string,
  label: string,
  steps: AutomationStepConfig[],
  rootIndex: number,
  depth: number,
  pathPrefix: string,
): void {
  if (steps.length === 0) {
    const emptyId = `${parentId}:empty:${label}`;
    node(ctx, emptyId, {
      kind: 'branchEmpty',
      rootIndex,
      title: `Empty · ${label}`,
      depth,
      hasError: false,
      interactive: rootIndex >= 0,
    });
    edge(ctx, parentId, emptyId, { label, branch: true });
    return;
  }
  let prev = parentId;
  let first = true;
  steps.forEach((step, i) => {
    const id = stepGraphId(step);
    addStepNode(ctx, step, id, rootIndex, depth, `${pathPrefix}[${i}]`);
    edge(ctx, prev, id, first ? { label, branch: true } : { branch: true });
    first = false;
    prev = id;
  });
}

/** Emits the node for a single step and, for control-flow steps, its branches. */
function addStepNode(
  ctx: Ctx,
  step: AutomationStepConfig,
  id: string,
  rootIndex: number,
  depth: number,
  path: string,
): void {
  if (step.type === CONDITIONAL_STEP_TYPE) {
    const cond = step as ConditionalStepConfig;
    node(ctx, id, {
      kind: 'conditional',
      rootIndex,
      title: 'Conditional',
      subtitle: 'If / else branch',
      depth,
      hasError: hasIssueUnder(ctx.issues, path),
      interactive: true,
    });
    layoutBranch(
      ctx,
      id,
      'True',
      cond.config.if_true ?? [],
      rootIndex,
      depth + 1,
      `${path}.config.if_true`,
    );
    layoutBranch(
      ctx,
      id,
      'False',
      cond.config.if_false ?? [],
      rootIndex,
      depth + 1,
      `${path}.config.if_false`,
    );
    return;
  }
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    node(ctx, id, {
      kind: 'switch',
      rootIndex,
      title: 'Switch',
      subtitle: `${sw.config.cases.length} case${sw.config.cases.length === 1 ? '' : 's'} + default`,
      depth,
      hasError: hasIssueUnder(ctx.issues, path),
      interactive: true,
    });
    sw.config.cases.forEach((c, i) => {
      layoutBranch(
        ctx,
        id,
        c.label || `Case ${i + 1}`,
        c.steps,
        rootIndex,
        depth + 1,
        `${path}.config.cases[${i}].steps`,
      );
    });
    layoutBranch(
      ctx,
      id,
      'Default',
      sw.config.default ?? [],
      rootIndex,
      depth + 1,
      `${path}.config.default`,
    );
    return;
  }
  const action = step as ActionStepConfig;
  node(ctx, id, {
    kind: 'action',
    rootIndex,
    title: catalogName(ctx.catalog, action.type),
    subtitle: catalogCategory(ctx.catalog, action.type),
    depth,
    hasError: hasIssueUnder(ctx.issues, path),
    interactive: true,
  });
}

/**
 * Builds the full node/edge graph for an automation and runs a top-to-bottom
 * dagre layout. The main spine is Trigger → Timing → Conditions → step0 → …
 * with inline "+" add affordances between top-level steps in edit mode.
 */
export function buildAutomationGraph(args: BuildGraphArgs): {
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

  const triggerName = args.triggerSchema?.name ?? (config.trigger.type || 'Choose a trigger');
  node(ctx, 'meta:trigger', {
    kind: 'trigger',
    rootIndex: -1,
    title: 'When this happens',
    subtitle: triggerName,
    depth: 0,
    hasError: hasIssueUnder(args.issues, 'trigger'),
    interactive: true,
  });
  node(ctx, 'meta:schedule', {
    kind: 'schedule',
    rootIndex: -1,
    title: 'Run timing',
    subtitle:
      config.schedule && config.schedule.type === 'SCHEDULED' ? 'Delayed run' : 'Run immediately',
    depth: 0,
    hasError: hasIssueUnder(args.issues, 'schedule'),
    interactive: true,
  });
  node(ctx, 'meta:conditions', {
    kind: 'conditions',
    rootIndex: -1,
    title: 'With these conditions',
    subtitle: 'Trigger filters',
    depth: 0,
    hasError: false,
    interactive: true,
  });
  edge(ctx, 'meta:trigger', 'meta:schedule');
  edge(ctx, 'meta:schedule', 'meta:conditions');

  let spinePrev = 'meta:conditions';

  const addSpineAdd = (insertAt: number): void => {
    if (!args.editMode) return;
    const id = `add:${insertAt}`;
    node(ctx, id, {
      kind: 'add',
      rootIndex: -1,
      title: 'Add step',
      depth: 0,
      hasError: false,
      insertAt,
      interactive: false,
    });
    edge(ctx, spinePrev, id);
    spinePrev = id;
  };

  config.steps.forEach((step, index) => {
    addSpineAdd(index);
    const id = stepGraphId(step);
    addStepNode(ctx, step, id, index, 0, `steps[${index}]`);
    edge(ctx, spinePrev, id);
    spinePrev = id;
  });
  addSpineAdd(config.steps.length);

  layout(ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

function layout(ctx: Ctx): void {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 56, marginx: 32, marginy: 32 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of ctx.nodes) {
    const isAdd = n.data.kind === 'add';
    g.setNode(n.id, {
      width: isAdd ? ADD_SIZE : NODE_WIDTH,
      height: isAdd ? ADD_SIZE : NODE_HEIGHT,
    });
  }
  for (const e of ctx.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  // dagre ships loose types; the graph builder is typed as Graph<any>.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  dagre.layout(g);
  for (const n of ctx.nodes) {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    const isAdd = n.data.kind === 'add';
    const w = isAdd ? ADD_SIZE : NODE_WIDTH;
    const h = isAdd ? ADD_SIZE : NODE_HEIGHT;
    n.position = { x: (pos?.x ?? 0) - w / 2, y: (pos?.y ?? 0) - h / 2 };
  }
}
