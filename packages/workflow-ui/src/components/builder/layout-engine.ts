/**
 * layout-engine — converts WorkflowConfig into ReactFlow nodes + edges.
 *
 * Pure function: no side effects, no React, no hooks.
 * Walks the step tree recursively, handles branches (CONDITIONAL, SWITCH),
 * and auto-positions nodes vertically.
 *
 * Inserts "addButton" nodes between steps for inline step insertion.
 */

import type { WorkflowStepConfig, WorkflowConfig } from '@xyne/workflow-sdk/builder';

// ─── Types ───

export interface LayoutNode {
  id: string;
  type: 'trigger' | 'step' | 'terminal' | 'addButton';
  position: { x: number; y: number };
  data: {
    stepConfig?: WorkflowStepConfig;
    triggerType?: string;
    triggerConfig?: Record<string, unknown>;
    label: string;
    /** For addButton nodes: which step to insert after */
    afterStepId?: string;
  };
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  data?: Record<string, unknown>;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

// ─── Helpers ───

function formatTypeName(type: string): string {
  return type
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ─── Constants ───

const NODE_GAP_Y = 90;
const NODE_GAP_X = 320;

// ─── Layout engine ───

interface LayoutState {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  y: number;
}

function addButtonBetween(
  sourceId: string,
  targetId: string,
  afterStepId: string,
  xOffset: number,
  state: LayoutState,
): void {
  const sourceNode = state.nodes.find((n) => n.id === sourceId);
  const targetNode = state.nodes.find((n) => n.id === targetId);
  if (!sourceNode || !targetNode) return;

  const btnId = `__add__${sourceId}->${targetId}`;
  const midY = (sourceNode.position.y + targetNode.position.y) / 2;

  state.nodes.push({
    id: btnId,
    type: 'addButton',
    position: { x: xOffset, y: midY },
    data: { label: '', afterStepId },
  });

  // Replace the direct edge with source → button → target
  const edgeIdx = state.edges.findIndex((e) => e.source === sourceId && e.target === targetId);
  if (edgeIdx >= 0) {
    const oldEdge = state.edges[edgeIdx]!;
    state.edges.splice(edgeIdx, 1);
    const srcToBtnEdge: LayoutEdge = { id: `${sourceId}->${btnId}`, source: sourceId, target: btnId };
    if (oldEdge.label) srcToBtnEdge.label = oldEdge.label;
    state.edges.push(
      srcToBtnEdge,
      { id: `${btnId}->${targetId}`, source: btnId, target: targetId },
    );
  }
}

export interface LayoutOptions {
  /** Insert addButton nodes between steps. Default true. */
  includeAddButtons?: boolean;
}

export function computeLayout(config: WorkflowConfig, options?: LayoutOptions): LayoutResult {
  const state: LayoutState = { nodes: [], edges: [], y: 0 };

  // Trigger node
  const triggerId = '__trigger__';
  state.nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x: 0, y: state.y },
    data: {
      triggerType: config.trigger.type,
      triggerConfig: config.trigger.config,
      label: formatTypeName(config.trigger.type) + ' Trigger',
    },
  });
  state.y += NODE_GAP_Y;

  // Walk steps
  let previousId = triggerId;
  previousId = layoutSteps(config.steps, previousId, 0, state);

  // Terminal node
  const terminalId = '__terminal__';
  state.nodes.push({
    id: terminalId,
    type: 'terminal',
    position: { x: 0, y: state.y },
    data: { label: 'End' },
  });
  state.edges.push({
    id: `${previousId}->${terminalId}`,
    source: previousId,
    target: terminalId,
  });

  // Insert add-buttons between consecutive nodes on the main chain
  if (options?.includeAddButtons !== false) {
    insertAddButtons(config.steps, triggerId, 0, state);
  }

  return { nodes: state.nodes, edges: state.edges };
}

/**
 * Insert add-button nodes between steps on a chain.
 * Does NOT handle branching sub-chains (kept simple for now).
 */
function insertAddButtons(
  steps: WorkflowStepConfig[],
  chainStartId: string,
  xOffset: number,
  state: LayoutState,
): void {
  const nodeIds = [chainStartId, ...steps.map((s) => s.id)];

  // Add button after each node (between node[i] → node[i+1])
  for (let i = 0; i < nodeIds.length; i++) {
    const sourceId = nodeIds[i]!;
    // Determine the target — either next step or terminal
    const targetId = i < steps.length ? steps[i]!.id : '__terminal__';
    // afterStepId: insert after source. For trigger, afterStepId is undefined (prepend)
    const afterStepId = sourceId === chainStartId && i === 0 ? '' : sourceId;

    addButtonBetween(sourceId, targetId, afterStepId, xOffset, state);
  }
}

function layoutSteps(
  steps: WorkflowStepConfig[],
  previousId: string,
  xOffset: number,
  state: LayoutState,
): string {
  let prevId = previousId;

  for (const step of steps) {
    const nodeId = step.id;

    state.nodes.push({
      id: nodeId,
      type: 'step',
      position: { x: xOffset, y: state.y },
      data: {
        stepConfig: step,
        label: formatTypeName(step.type),
      },
    });

    state.edges.push({
      id: `${prevId}->${nodeId}`,
      source: prevId,
      target: nodeId,
    });

    state.y += NODE_GAP_Y;

    // Handle branching steps
    const branches = detectBranches(step);
    if (branches) {
      const rejoinId = `${nodeId}__rejoin`;
      const branchEntries = Object.entries(branches);
      const totalWidth = (branchEntries.length - 1) * NODE_GAP_X;
      const startX = xOffset - totalWidth / 2;

      let maxY = state.y;

      for (let i = 0; i < branchEntries.length; i++) {
        const [branchKey, branchSteps] = branchEntries[i]!;
        const branchX = startX + i * NODE_GAP_X;
        const savedY = state.y;

        if (branchSteps.length > 0) {
          const lastId = layoutSteps(branchSteps, nodeId, branchX, state);

          // Edge from branch to rejoin
          state.edges.push({
            id: `${lastId}->${rejoinId}`,
            source: lastId,
            target: rejoinId,
          });

          // Label the branch edge
          const edgeIdx = state.edges.findIndex((e) => e.source === nodeId && e.target === branchSteps[0]!.id);
          if (edgeIdx >= 0) {
            state.edges[edgeIdx]!.label = branchKey;
          }
        } else {
          // Empty branch — direct edge from step to rejoin
          state.edges.push({
            id: `${nodeId}->${rejoinId}::${branchKey}`,
            source: nodeId,
            target: rejoinId,
            label: branchKey,
          });
        }

        if (state.y > maxY) maxY = state.y;
        state.y = savedY;
      }

      state.y = maxY;

      // Rejoin node (invisible — just a merge point)
      state.nodes.push({
        id: rejoinId,
        type: 'step',
        position: { x: xOffset, y: state.y },
        data: { label: '' },
      });
      state.y += NODE_GAP_Y;

      prevId = rejoinId;
    } else {
      prevId = nodeId;
    }
  }

  return prevId;
}

function detectBranches(
  step: WorkflowStepConfig,
): Record<string, WorkflowStepConfig[]> | null {
  if (!('config' in step) || typeof step.config !== 'object' || step.config === null) {
    return null;
  }
  const config = step.config as Record<string, unknown>;

  // CONDITIONAL: if_true / if_false
  if (Array.isArray(config['if_true']) || Array.isArray(config['if_false'])) {
    return {
      'true': (config['if_true'] ?? []) as WorkflowStepConfig[],
      'false': (config['if_false'] ?? []) as WorkflowStepConfig[],
    };
  }

  // SWITCH: cases
  if (Array.isArray(config['cases'])) {
    const branches: Record<string, WorkflowStepConfig[]> = {};
    const cases = config['cases'] as Array<{ key?: string; steps?: WorkflowStepConfig[] }>;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!;
      const key = c.key ?? `case_${String(i)}`;
      branches[key] = c.steps ?? [];
    }
    if (Array.isArray(config['default'])) {
      branches['default'] = config['default'] as WorkflowStepConfig[];
    }
    return branches;
  }

  // LOOP: body
  if (Array.isArray(config['body'])) {
    return {
      'body': config['body'] as WorkflowStepConfig[],
    };
  }

  // PARALLEL: branches (Record<string, WorkflowStepConfig[]>)
  if (config['branches'] && typeof config['branches'] === 'object' && !Array.isArray(config['branches'])) {
    const raw = config['branches'] as Record<string, unknown>;
    const branches: Record<string, WorkflowStepConfig[]> = {};
    for (const [key, val] of Object.entries(raw)) {
      branches[key] = Array.isArray(val) ? val as WorkflowStepConfig[] : [];
    }
    if (Object.keys(branches).length > 0) return branches;
  }

  return null;
}
