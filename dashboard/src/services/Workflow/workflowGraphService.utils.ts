/**
 * Workflow Graph Service Utilities
 * Pure utility functions for workflow graph operations and data transformations
 */

import {
  WorkflowStep,
  ASTGraph,
  ASTGraphNode,
  ASTGraphEdge,
  CombinedWorkflowData,
  WorkflowNode,
  WorkflowEdge,
  WorkflowStepData,
} from './workflowGraphService.types';

/**
 * Flatten workflow steps including expanded steps and executions
 */
export const flattenWorkflowSteps = (steps: WorkflowStep[]): WorkflowStep[] => {
  const flattened: WorkflowStep[] = [];

  const processStep = (step: WorkflowStep): void => {
    flattened.push(step);

    if (step.expandedSteps?.length) {
      step.expandedSteps.forEach(processStep);
    }

    if (step.expandedExecutions?.length) {
      step.expandedExecutions.forEach(execution => {
        execution.steps.forEach(processStep);
      });
    }
  };

  steps.forEach(processStep);
  return flattened;
};

type NormalizedStep = {
  primary: WorkflowStep | undefined;
  all: WorkflowStep[];
};

const normalizeStep = (step: WorkflowStep | WorkflowStep[] | undefined): NormalizedStep => {
  if (!step) {
    return { primary: undefined, all: [] };
  }

  if (Array.isArray(step)) {
    return {
      primary: step[0],
      all: step,
    };
  }

  return {
    primary: step,
    all: [step],
  };
};

/**
 * Convert AST Graph to Workflow UI format
 */
export const convertASTGraphToWorkflowUILight = (
  astGraph: ASTGraph,
  combinedData: CombinedWorkflowData,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => {
  const mapNodeType = (astType: string): 'start' | 'end' | 'task' | 'decision' => {
    if (astType === 'conditional') return 'decision';
    return 'task';
  };

  const allSteps = combinedData.workflows[0]?.steps || [];
  const workflowStatus = combinedData.workflows[0]?.executionStatus || 'UNKNOWN';

  const isWorkflowTerminal = (): boolean =>
    ['SUCCESS', 'FAILURE', 'CANCELLED'].includes(workflowStatus);

  const findStepViaDFS = (nodeId: string): WorkflowStep | WorkflowStep[] | undefined => {
    if (!allSteps) return undefined;

    const parallelChildMatch = nodeId.match(/^(.+)_child_(\d+)_(.+)$/);

    if (parallelChildMatch) {
      const [, parentStepName, childIndexStr, childStepName] = parallelChildMatch;

      if (!parentStepName || !childIndexStr || !childStepName) return undefined;

      const childIndex = parseInt(childIndexStr, 10);

      const parentNode = allSteps.filter(step => step.stepName?.endsWith(parentStepName));
      const allChildExecutions = parentNode[0]?.expandedWorkflows;

      if (!allChildExecutions?.[childIndex]?.steps) return undefined;

      const targetSteps = allChildExecutions[childIndex].steps;

      const node = Object.values(targetSteps).find(step => step.stepName?.endsWith(childStepName));

      if (node) return node;

      return Object.values(targetSteps).find(
        step => step.stepName?.includes('iter') && step.stepName?.endsWith(childStepName),
      );
    }

    const foundSteps = allSteps.filter(step => step.stepName?.endsWith(nodeId));

    if (foundSteps[0]?.stepExecutorType === 'loops') {
      return foundSteps.filter(step => step.type === 'input');
    }

    return foundSteps[0];
  };

  const stepCache = new Map<string, WorkflowStep | WorkflowStep[] | undefined>();

  const getStepData = (nodeId: string): WorkflowStep | WorkflowStep[] | undefined => {
    if (!stepCache.has(nodeId)) {
      stepCache.set(nodeId, findStepViaDFS(nodeId));
    }
    return stepCache.get(nodeId);
  };

  const getNodeStatusLight = (
    nodeId: string,
  ): 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped' | 'not_executed' => {
    const { primary, all } = normalizeStep(getStepData(nodeId));

    if (!primary) {
      return isWorkflowTerminal() ? 'not_executed' : 'pending';
    }

    if (all.length > 1) {
      if (all.some(s => s.computedStatus === 'running')) return 'running';
      if (all.some(s => s.computedStatus === 'failed')) return 'failed';
      if (all.every(s => s.computedStatus === 'completed')) return 'completed';
      return 'pending';
    }

    return (primary.computedStatus || 'pending') as
      | 'pending'
      | 'running'
      | 'completed'
      | 'failed'
      | 'paused'
      | 'skipped'
      | 'not_executed';
  };

  const getExecutorTypeLight = (nodeId: string): string | undefined => {
    const { primary } = normalizeStep(getStepData(nodeId));
    return primary?.stepExecutorType;
  };

  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  astGraph.edges.forEach((edge: ASTGraphEdge) => {
    if (!childrenMap.has(edge.source)) childrenMap.set(edge.source, []);
    childrenMap.get(edge.source)!.push(edge.target);
    parentMap.set(edge.target, edge.source);
  });

  const rootNodes = astGraph.nodes.filter((node: ASTGraphNode) => !parentMap.has(node.id));
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  const calculateLevels = (nodeId: string, level: number): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    levels.set(nodeId, level);
    (childrenMap.get(nodeId) || []).forEach(child => calculateLevels(child, level + 1));
  };

  rootNodes.forEach(root => calculateLevels(root.id, 0));

  const nodesByLevel = new Map<number, string[]>();
  levels.forEach((level, nodeId) => {
    if (!nodesByLevel.has(level)) nodesByLevel.set(level, []);
    nodesByLevel.get(level)!.push(nodeId);
  });

  const LEVEL_HEIGHT = 150;
  const NODE_WIDTH = 256;
  const MIN_NODE_SPACING = 120;

  const nodes: WorkflowNode[] = [];

  nodesByLevel.forEach((nodesInLevel, level) => {
    const totalWidth =
      nodesInLevel.length * NODE_WIDTH + (nodesInLevel.length - 1) * MIN_NODE_SPACING;

    const startX = -totalWidth / 2;

    nodesInLevel.forEach((nodeId, index) => {
      const astNode = astGraph.nodes.find(n => n.id === nodeId)!;

      const isFirstNode = level === 0 && rootNodes.length === 1;
      const isLastNode = !childrenMap.has(nodeId) || childrenMap.get(nodeId)!.length === 0;

      let nodeType: 'start' | 'end' | 'task' | 'decision' = mapNodeType(astNode.type);
      if (isFirstNode) nodeType = 'start';
      else if (isLastNode && level === Math.max(...Array.from(levels.values()))) {
        nodeType = 'end';
      }

      const position = {
        x: startX + index * (NODE_WIDTH + MIN_NODE_SPACING) + NODE_WIDTH / 2,
        y: level * LEVEL_HEIGHT + 50,
      };

      const { primary: matchedStep, all: matchedSteps } = normalizeStep(getStepData(astNode.id));

      const nodeStatus = getNodeStatusLight(astNode.id);

      let stepData: WorkflowStepData | null = null;
      if (matchedStep?.data) {
        try {
          stepData =
            typeof matchedStep.data === 'string'
              ? (JSON.parse(matchedStep.data) as WorkflowStepData)
              : matchedStep.data;
        } catch {
          stepData = matchedStep.data;
        }
      }

      const externalMetadata = stepData?.externalMetadata;

      const executionIds = matchedSteps.map(s => s.id).filter((id): id is string => !!id);

      nodes.push({
        id: nodeId,
        type: nodeType,
        position,
        data: {
          label: astNode.name,
          status: nodeStatus === 'skipped' ? 'paused' : nodeStatus,

          executorType: getExecutorTypeLight(astNode.id),

          // single
          executionStep: matchedStep,

          duration: matchedStep?.duration,
          externalStepType: externalMetadata?.type,

          workflowExecutionId: matchedStep?.workflowExecutionId,
          workflowStepId: matchedStep?.id,

          workflowStepIds: executionIds,
        },
      });
    });
  });

  const edges: WorkflowEdge[] = astGraph.edges
    .filter(e => nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target))
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type || 'default',
      animated: false,
    }));

  return { nodes, edges };
};
