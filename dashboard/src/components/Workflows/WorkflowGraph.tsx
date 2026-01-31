import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { NodeProps, ReactFlowProvider } from 'reactflow';
import { useQuery } from '@tanstack/react-query';
import {
  WorkflowCanvas,
  Modal,
  type BlendNode,
  type BlendEdge,
  type Connection,
} from '@juspay/blend-design-system';
import TaskNode, { NodeData } from './TaskNode';
import { type NodeAction } from './constants';
import StepDetails from './StepDetails';
import {
  CombinedWorkflowData,
  StepDetailsResponse,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowGraph as WorkflowGraphType,
} from '../../services/Workflow/workflowGraphService.types';
import { convertASTGraphToWorkflowUILight } from '../../services/Workflow/workflowGraphService.utils';
import { downloadJsonAsCsv, JsonObject } from './utils/convertToCSV';
import { WorkflowStep } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { useWorkflowControl } from '../../services/Workflow/workflowGraphService';
import { toast } from 'sonner';

// Custom hooks to replace service function calls
const useWorkflowGraph = (
  workflowType: string | undefined,
  enabled = true,
): ReturnType<typeof useQuery<WorkflowGraphType, Error>> => {
  return useQuery({
    queryKey: ['workflow-graph', workflowType],
    queryFn: async (): Promise<WorkflowGraphType> => {
      if (!workflowType) throw new Error('Workflow type is required');
      const response = await apiInstance.get<WorkflowGraphType>(`/workflows/graph/${workflowType}`);
      return response.data;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes (workflow graphs are relatively static)
    retry: 2,
    enabled: Boolean(workflowType && enabled),
  });
};

const useStepDetails = (
  stepId: string | null,
  enabled = true,
): ReturnType<typeof useQuery<StepDetailsResponse, Error>> => {
  return useQuery({
    queryKey: ['step-details', stepId],
    queryFn: async (): Promise<StepDetailsResponse> => {
      if (!stepId) throw new Error('Step ID is required');
      const response = await apiInstance.get<StepDetailsResponse>(
        `/workflows/workflow-steps/${stepId}/details`,
      );
      return response.data;
    },
    staleTime: 0, // 2 minutes (step details are relatively stable)
    retry: 2,
    enabled: Boolean(stepId && enabled),
  });
};

// Extended node data interface that includes Blend-specific properties
interface ExtendedWorkflowNodeData extends WorkflowNodeData {
  originalStatus?: string;
  [key: string]: unknown;
}

// Helper function to safely extract node data
const extractNodeData = (
  nodeData: WorkflowNodeData | Record<string, unknown>,
): ExtendedWorkflowNodeData => {
  return nodeData as ExtendedWorkflowNodeData;
};

interface WorkflowGraphProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onRefresh?: () => void;
  onExport?: () => void;
  onExecutionChange?: (newExecutionId: string) => void;
}

// Typed node wrapper component
const createNodeWrapper = (
  nodeType: 'task' | 'start' | 'end' | 'decision',
): React.FC<NodeProps<NodeData>> => {
  const NodeWrapper: React.FC<NodeProps<NodeData>> = props => {
    return <TaskNode {...props} type={nodeType} />;
  };

  return NodeWrapper;
};

const TaskNodeWrapper: React.FC<NodeProps> = createNodeWrapper('task');
const StartNodeWrapper: React.FC<NodeProps> = createNodeWrapper('start');
const EndNodeWrapper: React.FC<NodeProps> = createNodeWrapper('end');
const DecisionNodeWrapper: React.FC<NodeProps> = createNodeWrapper('decision');

const EnhancedWorkflowGraphInner: React.FC<WorkflowGraphProps> = ({
  nodes: initialNodes,
  edges: initialEdges,
  onRefresh,
  onExport,
  onExecutionChange,
}) => {
  const [nodes, setNodes] = useState<BlendNode[]>([]);
  const [edges, setEdges] = useState<BlendEdge[]>([]);
  const [loadingStage, setLoadingStage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedStepWorkflowStepIds, setSelectedStepWorkflowStepIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const disableProgressiveLoading = false;

  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [rerunStepInfo, setRerunStepInfo] = useState<{
    stepId: string;
    stepName: string;
    nodeId: string;
    workflowExecutionId: string;
  } | null>(null);

  const { restoreExecutionAsync } = useWorkflowControl();

  // Use the custom hook to get step details
  const { data: stepDetails, isLoading: _stepDetailsLoading } = useStepDetails(selectedStepId);

  // Combine step details with workflow step IDs
  const selectedStep = useMemo(() => {
    if (!stepDetails) return null;
    return {
      ...stepDetails,
      workflowStepIds: selectedStepWorkflowStepIds,
    };
  }, [stepDetails, selectedStepWorkflowStepIds]);

  const nodeTypes = useMemo(
    () => ({
      task: TaskNodeWrapper,
      start: StartNodeWrapper,
      end: EndNodeWrapper,
      decision: DecisionNodeWrapper,
    }),
    [],
  );

  const mapStatus = (status?: string): 'default' | 'error' | 'success' | 'warning' => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'warning';
      default:
        return 'default';
    }
  };

  const toBlendNodes = (workflowNodes: WorkflowNode[]): BlendNode[] =>
    workflowNodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        status: mapStatus(n.data.status),
        originalStatus: n.data.status || 'pending',
      },
    })) as BlendNode[];

  const toBlendEdges = (workflowEdges: WorkflowEdge[]): BlendEdge[] =>
    workflowEdges.map(e => ({ ...e })) as BlendEdge[];

  useEffect(() => {
    if (initialNodes.length === 0) return;

    // Auto-select the first node
    const selectFirstNode = (): void => {
      if (initialNodes.length > 0) {
        const firstNode = initialNodes[0];
        if (!firstNode || initialNodes.length === 0 || !firstNode.data) return;

        setSelectedStepId(firstNode?.data?.workflowStepId || null);
        setSelectedStepWorkflowStepIds(firstNode?.data['workflowStepIds'] || []);
      }
    };

    if (disableProgressiveLoading) {
      setNodes(toBlendNodes(initialNodes));
      setEdges(toBlendEdges(initialEdges));
      setLoadingStage(5);
      selectFirstNode();
      return;
    }

    const load = async (): Promise<void> => {
      const totalStages = 5;
      const nodesPerStage = Math.ceil(initialNodes.length / totalStages);

      for (let stage = 0; stage < totalStages; stage++) {
        const sliceEnd = (stage + 1) * nodesPerStage;
        const partial = initialNodes.slice(0, sliceEnd);

        setNodes(toBlendNodes(partial));
        setLoadingStage(stage + 1);

        if (stage < totalStages - 1) {
          await new Promise(r => setTimeout(r, 250));
        }
      }

      setEdges(toBlendEdges(initialEdges));
      selectFirstNode();
    };

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges, disableProgressiveLoading]);

  useEffect(() => {
    const cb = (): void => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cb);
    return (): void => document.removeEventListener('fullscreenchange', cb);
  }, []);

  const handleStepClick = useCallback((stepId: string | null, workflowStepIds: string[] = []) => {
    setSelectedStepId(stepId);
    setSelectedStepWorkflowStepIds(workflowStepIds);
  }, []);

  const handleConfirmRerun = useCallback(async () => {
    if (!rerunStepInfo) return;

    setShowRerunConfirm(false);

    try {
      toast.loading('Creating rerun from this step...', { id: 'rerun-loading' });

      const result = await restoreExecutionAsync({
        executionId: rerunStepInfo.workflowExecutionId,
        stepId: rerunStepInfo.stepId,
      });

      toast.success('Rerun created successfully! Switching to new execution...', {
        id: 'rerun-loading',
      });

      if (onExecutionChange && result.rerunExecutionId) {
        onExecutionChange(result.rerunExecutionId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Failed to create rerun: ${errorMessage}`, { id: 'rerun-loading' });
    } finally {
      setRerunStepInfo(null);
    }
  }, [rerunStepInfo, restoreExecutionAsync, onExecutionChange]);

  const handleNodeAction = useCallback(
    (nodeId: string, action: NodeAction) => {
      if (action === 'restart') {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) {
          toast.error('Cannot create rerun: node not found');
          return;
        }

        const data = extractNodeData(node.data);
        const step = data['executionStep'] as WorkflowStep | undefined;

        if (!step?.id || !step?.workflowExecutionId) {
          toast.error('Cannot create rerun: step information not found');
          return;
        }

        setRerunStepInfo({
          stepId: step.id,
          stepName: step.stepName || 'Unknown Step',
          nodeId: nodeId,
          workflowExecutionId: step.workflowExecutionId,
        });
        setShowRerunConfirm(true);
        return;
      }

      setNodes(ns =>
        ns.map(n => {
          if (n.id !== nodeId) return n;
          const data = extractNodeData(n.data);

          let newStatus: string =
            typeof data.originalStatus === 'string' ? data.originalStatus : 'pending';

          if (action === 'resume') newStatus = 'running';
          if (action === 'pause') newStatus = 'paused';
          if (action === 'stop') newStatus = 'failed';

          return {
            ...n,
            data: {
              ...n.data,
              originalStatus: newStatus,
              status: mapStatus(newStatus),
              onAction: (a: NodeAction): void => {
                void handleNodeAction(nodeId, a);
              },
            },
          };
        }),
      );
    },
    [nodes],
  );

  const blendNodes = useMemo(
    () =>
      nodes.map(n => ({
        ...n,
        data: {
          ...n.data,
          onAction: (action: NodeAction): void => {
            void handleNodeAction(n.id, action);
          },
          onStepClick: (): void => {
            const step = n.data['executionStep'] as WorkflowStep | undefined;
            if (step && step?.id && typeof step?.id === 'string') {
              const executionSteps = n.data['workflowStepIds'] as string[] | undefined;
              handleStepClick(step.id, executionSteps ?? []);
            }
          },
        },
      })),
    [nodes, handleNodeAction, handleStepClick],
  );

  const blendEdges = useMemo(() => {
    const groups = new Map<string, BlendEdge[]>();
    edges.forEach(e => {
      const key = `${e.source}->${e.target}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    });

    return edges.map(edge => {
      const key = `${edge.source}->${edge.target}`;
      const group = groups.get(key) || [];
      const idx = group.findIndex(e => e.id === edge.id);
      const total = group.length;

      let color = '#e5e7eb';
      let width = 2;
      let type = 'straight';
      const animated = false;

      if (total > 1) {
        const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
        color = palette[idx % palette.length] || '#6b7280';
        width = 1.5;
        type = 'smoothstep';
      }

      return {
        ...edge,
        animated,
        type,
        style: { stroke: color, strokeWidth: width },
        markerEnd: {
          type: 'arrowclosed',
          color,
          width: 14,
          height: 14,
          strokeWidth: 1.5,
        },
      };
    }) as BlendEdge[];
  }, [edges]);

  const ActionButtons = (): React.JSX.Element => (
    <div className='absolute top-3 right-3 z-10 flex items-center gap-2'>
      {/* Refresh */}
      <button
        onClick={onRefresh}
        disabled={!onRefresh || loadingStage < 5}
        className='flex items-center justify-center w-8 h-8 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200'
        title='Refresh workflow data'
      >
        <svg
          className={`w-4 h-4 text-gray-500 ${loadingStage < 5 ? 'animate-spin' : ''}`}
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
          />
        </svg>
      </button>

      {/* Export */}
      <button
        onClick={onExport}
        className='flex items-center justify-center w-8 h-8 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200'
        title='Export workflow data'
      >
        <svg
          className='w-4 h-4 text-gray-500'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M12 16v-8m0 0l-3 3m3-3l3 3M4 16h16'
          />
        </svg>
      </button>

      {/* Fullscreen */}
      <button
        onClick={() => {
          void containerRef.current?.requestFullscreen();
        }}
        className='flex items-center justify-center w-8 h-8 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow hover:bg-gray-50 transition-all duration-200'
        title='Fullscreen'
      >
        <svg
          className='w-4 h-4 text-gray-500'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4'
          />
        </svg>
      </button>
    </div>
  );

  const handleNavigateAttempt = useCallback(
    (direction: 'previous' | 'next') => {
      if (!selectedStep) return;

      const ids = selectedStep.workflowStepIds;
      const currentId = selectedStep.originalStep?.id;

      const idx = ids.findIndex(id => id === currentId);
      if (idx === -1) return;

      const nextIdx =
        direction === 'previous' ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);

      const targetExecutionId = ids[nextIdx];

      if (!targetExecutionId) return;

      setSelectedStepId(targetExecutionId);
      setSelectedStepWorkflowStepIds(ids);
    },
    [selectedStep],
  );

  return (
    <div className='bg-gray-50 h-full'>
      {/* Clean container */}
      <div className='h-full bg-white overflow-hidden'>
        <div className='flex h-full'>
          {/* Step Details Panel - LEFT */}
          <div className='w-4/5 border-r border-gray-100 bg-white flex flex-col min-w-0 overflow-hidden'>
            <div className='flex-1 overflow-y-auto overflow-x-hidden min-w-0'>
              <StepDetails step={selectedStep} onNavigateAttempt={handleNavigateAttempt} />
            </div>
          </div>

          {/* Workflow Graph - RIGHT */}
          <div
            className={`w-1/5 relative bg-slate-50 ${isFullscreen ? 'workflow-graph-fullscreen' : ''}`}
            ref={containerRef}
          >
            {loadingStage < 5 && (
              <div className='absolute top-3 left-3 bg-white px-2.5 py-1.5 rounded-lg shadow-sm text-xs text-gray-500 z-10 border border-gray-100'>
                Loading... {loadingStage}/5
              </div>
            )}

            <WorkflowCanvas
              nodes={blendNodes}
              edges={blendEdges}
              onNodesChange={setNodes}
              onEdgesChange={setEdges}
              onConnect={(c: Connection) => {
                if (!c.source || !c.target) return;

                const source = c.source;
                const target = c.target;

                setEdges(prev => [
                  ...prev,
                  {
                    id: `e${source}-${target}`,
                    source,
                    target,
                    data: { label: '' },
                  } satisfies BlendEdge,
                ]);
              }}
              nodeTypes={nodeTypes}
              fitView
              showControls
              showMinimap
              height='100%'
              showBackground
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
            >
              <>
                <ActionButtons />
              </>
            </WorkflowCanvas>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showRerunConfirm}
        onClose={() => {
          setShowRerunConfirm(false);
          setRerunStepInfo(null);
        }}
        title='Confirm Rerun'
        showCloseButton={true}
        primaryAction={{
          text: 'Create Rerun',
          onClick: () => {
            void handleConfirmRerun();
          },
        }}
        secondaryAction={{
          text: 'Cancel',
          onClick: () => {
            setShowRerunConfirm(false);
            setRerunStepInfo(null);
          },
        }}
      >
        <div className='p-4'>
          <p className='text-gray-900 mb-4'>
            This will create a new execution starting from the following step:
          </p>
          <div className='bg-gray-50 rounded-lg p-3 border border-gray-200'>
            <p className='font-medium text-gray-900'>{rerunStepInfo?.stepName || 'Unknown Step'}</p>
            <p className='text-sm text-gray-600 mt-1'>
              All steps including this point will be re-executed in the new attempt.
            </p>
          </div>
          <p className='text-sm text-gray-500 mt-4'>
            The new execution will appear as a new attempt in the dropdown.
          </p>
        </div>
      </Modal>
    </div>
  );
};

interface WorkflowGraphComponentProps {
  workflowData: QueryResultType<typeof queries.getWorkflowForTicket>;
  combinedStepsData: CombinedWorkflowData;
  loading?: boolean;
  onRefresh?: () => void;
  onExecutionChange?: (newExecutionId: string) => void;
}

export const WorkflowGraph: React.FC<WorkflowGraphComponentProps> = ({
  workflowData,
  combinedStepsData,
  loading: _loading = false,
  onRefresh,
  onExecutionChange,
}) => {
  // Use the custom hook to get workflow graph
  const {
    data: astGraph,
    isLoading: graphLoading,
    error: graphError,
  } = useWorkflowGraph(workflowData[0]?.workflowType || undefined, Boolean(combinedStepsData));

  // Convert AST graph to workflow UI data
  const { nodes, edges } = useMemo(() => {
    if (!astGraph || !combinedStepsData) {
      return { nodes: [], edges: [] };
    }

    try {
      const result = convertASTGraphToWorkflowUILight(astGraph, combinedStepsData);
      return {
        nodes: result.nodes || [],
        edges: result.edges || [],
      };
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [astGraph, combinedStepsData]);

  const exportData = (): void => {
    const filename = `${workflowData[0]?.id}_executions_${new Date().toISOString().split('T')[0]}.csv`;
    const combinedStepsJson: JsonObject = JSON.parse(
      JSON.stringify(combinedStepsData),
    ) as JsonObject;
    void downloadJsonAsCsv(combinedStepsJson, filename, undefined, workflowData[0]?.id);
  };

  // Show loading state
  if (graphLoading) {
    return (
      <div className='flex items-center justify-center h-96'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4' />
          <p className='text-gray-600'>Loading workflow graph...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (graphError) {
    return (
      <div className='flex items-center justify-center h-96'>
        <div className='text-center'>
          <div className='mx-auto mb-4 w-12 h-12 text-red-500'>
            <svg fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
          </div>
          <h3 className='text-lg font-medium text-gray-900 mb-2'>Failed to load workflow graph</h3>
          <p className='text-gray-600 mb-4'>
            {graphError instanceof Error ? graphError.message : 'Unknown error occurred'}
          </p>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors'
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <EnhancedWorkflowGraphInner
        nodes={nodes}
        edges={edges}
        {...(onRefresh ? { onRefresh } : {})}
        onExport={exportData}
        {...(onExecutionChange ? { onExecutionChange } : {})}
      />
    </ReactFlowProvider>
  );
};
