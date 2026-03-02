/**
 * WorkflowGraphOnly - Graph-only view without StepDetails panel.
 * A lighter version for embedding in tabbed layouts.
 */
import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { NodeProps, ReactFlowProvider } from 'reactflow';
import { useQuery } from '@tanstack/react-query';
import {
  WorkflowCanvas,
  type BlendNode,
  type BlendEdge,
  type Connection,
} from '@juspay/blend-design-system';
import TaskNode, { NodeData } from './TaskNode';
import { type NodeAction } from './constants';
import {
  CombinedWorkflowData,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowGraph as WorkflowGraphType,
} from '../../services/Workflow/workflowGraphService.types';
import { convertASTGraphToWorkflowUILight } from '../../services/Workflow/workflowGraphService.utils';
import { downloadJsonAsCsv, JsonObject } from './utils/convertToCSV';
import { WorkflowStep } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import { RefreshCw, Download, Maximize2, Minimize2 } from 'lucide-react';
import { useWorkflowControl } from '../../services/Workflow/workflowGraphService';
import { toast } from 'sonner';
import { Modal } from '@juspay/blend-design-system';

interface ExtendedWorkflowNodeData extends WorkflowNodeData {
  originalStatus?: string;
  [key: string]: unknown;
}

const useWorkflowGraphData = (
  workflowType: string | undefined,
  enabled = true,
): ReturnType<typeof useQuery<WorkflowGraphType, Error>> =>
  useQuery({
    queryKey: ['workflow-graph', workflowType],
    queryFn: async (): Promise<WorkflowGraphType> => {
      if (!workflowType) throw new Error('Workflow type is required');
      return (await apiInstance.get<WorkflowGraphType>(`/workflows/graph/${workflowType}`)).data;
    },
    staleTime: 30 * 60 * 1000,
    retry: 2,
    enabled: Boolean(workflowType && enabled),
  });

const mapStatus = (status?: string): 'default' | 'error' | 'success' | 'warning' =>
  status === 'completed'
    ? 'success'
    : status === 'failed'
      ? 'error'
      : status === 'running'
        ? 'warning'
        : 'default';

const TaskNodeWrapper: React.FC<NodeProps<NodeData>> = props => <TaskNode {...props} type='task' />;
TaskNodeWrapper.displayName = 'TaskNodeWrapper';
const StartNodeWrapper: React.FC<NodeProps<NodeData>> = props => (
  <TaskNode {...props} type='start' />
);
StartNodeWrapper.displayName = 'StartNodeWrapper';
const EndNodeWrapper: React.FC<NodeProps<NodeData>> = props => <TaskNode {...props} type='end' />;
EndNodeWrapper.displayName = 'EndNodeWrapper';
const DecisionNodeWrapper: React.FC<NodeProps<NodeData>> = props => (
  <TaskNode {...props} type='decision' />
);
DecisionNodeWrapper.displayName = 'DecisionNodeWrapper';
const nodeTypes = {
  task: TaskNodeWrapper,
  start: StartNodeWrapper,
  end: EndNodeWrapper,
  decision: DecisionNodeWrapper,
};

interface InnerProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onRefresh?: (() => void) | undefined;
  onExport: () => void;
  onNodeSelect?: ((stepId: string | null, workflowStepIds: string[]) => void) | undefined;
  onExecutionChange?: ((newExecutionId: string) => void) | undefined;
}

const GraphInner: React.FC<InnerProps> = ({
  nodes: initialNodes,
  edges: initialEdges,
  onRefresh,
  onExport,
  onNodeSelect,
  onExecutionChange,
}) => {
  const [nodes, setNodes] = useState<BlendNode[]>([]);
  const [edges, setEdges] = useState<BlendEdge[]>([]);
  const [loadingStage, setLoadingStage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Rerun state
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [rerunStepInfo, setRerunStepInfo] = useState<{
    stepId: string;
    stepName: string;
    workflowExecutionId: string;
  } | null>(null);
  const { restoreExecutionAsync } = useWorkflowControl();

  const toBlendNodes = useCallback(
    (wn: WorkflowNode[]): BlendNode[] =>
      wn.map(n => ({
        ...n,
        data: {
          ...n.data,
          status: mapStatus(n.data.status),
          originalStatus: n.data.status || 'pending',
        },
      })) as BlendNode[],
    [],
  );
  const toBlendEdges = useCallback(
    (we: WorkflowEdge[]): BlendEdge[] => we.map(e => ({ ...e })) as BlendEdge[],
    [],
  );

  useEffect(() => {
    if (!initialNodes.length) return;
    const timer = setTimeout(() => {
      setNodes(toBlendNodes(initialNodes));
      setEdges(toBlendEdges(initialEdges));
      setLoadingStage(5);
    }, 50);
    return () => clearTimeout(timer);
  }, [initialNodes, initialEdges, toBlendNodes, toBlendEdges]);

  useEffect(() => {
    const cb = (): void => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cb);
    return (): void => {
      document.removeEventListener('fullscreenchange', cb);
    };
  }, []);

  const handleStepClick = useCallback(
    (stepId: string | null, ids: string[] = []): void => onNodeSelect?.(stepId, ids),
    [onNodeSelect],
  );

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
    (nodeId: string, action: NodeAction): void => {
      if (action === 'restart') {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) {
          toast.error('Cannot create rerun: node not found');
          return;
        }
        const data = node.data as unknown as ExtendedWorkflowNodeData;
        const step = data['executionStep'] as WorkflowStep | undefined;
        if (!step?.id || !step?.workflowExecutionId) {
          toast.error('Cannot create rerun: step information not found');
          return;
        }
        setRerunStepInfo({
          stepId: step.id,
          stepName: step.stepName || 'Unknown Step',
          workflowExecutionId: step.workflowExecutionId,
        });
        setShowRerunConfirm(true);
        return;
      }

      setNodes(ns =>
        ns.map(n => {
          if (n.id !== nodeId) return n;
          const data = n.data as unknown as ExtendedWorkflowNodeData;
          let newStatus = typeof data.originalStatus === 'string' ? data.originalStatus : 'pending';
          if (action === 'resume') newStatus = 'running';
          if (action === 'pause') newStatus = 'paused';
          if (action === 'stop') newStatus = 'failed';
          return {
            ...n,
            data: { ...n.data, originalStatus: newStatus, status: mapStatus(newStatus) },
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
          onAction: (a: NodeAction): void => handleNodeAction(n.id, a),
          onStepClick: (): void => {
            const step = n.data['executionStep'] as WorkflowStep | undefined;
            if (step?.id) handleStepClick(step.id, (n.data['workflowStepIds'] as string[]) ?? []);
          },
        },
      })),
    [nodes, handleNodeAction, handleStepClick],
  );

  const blendEdges = useMemo(() => {
    const groups = new Map<string, BlendEdge[]>();
    edges.forEach(e => {
      const k = `${e.source}->${e.target}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    });
    return edges.map(edge => {
      const g = groups.get(`${edge.source}->${edge.target}`) || [];
      const idx = g.findIndex(e => e.id === edge.id);
      const [color, width, type] =
        g.length > 1
          ? [['#3b82f6', '#10b981', '#f59e0b', '#ef4444'][idx % 4] || '#6b7280', 1.5, 'smoothstep']
          : ['#e5e7eb', 2, 'straight'];
      return {
        ...edge,
        animated: false,
        type,
        style: { stroke: color, strokeWidth: width },
        markerEnd: { type: 'arrowclosed', color, width: 14, height: 14, strokeWidth: 1.5 },
      };
    }) as BlendEdge[];
  }, [edges]);

  const toggleFs = (): void => {
    if (containerRef.current) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void containerRef.current.requestFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`h-full w-full relative bg-white ${isFullscreen ? 'workflow-graph-fullscreen' : ''}`}
    >
      <div className='absolute top-3 left-3 z-10 flex items-center gap-2'>
        <button
          onClick={onRefresh}
          disabled={!onRefresh || loadingStage < 5}
          className='p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-all'
          title='Refresh'
          data-track-category='Workflows'
          data-track-name='RefreshWorkflow'
        >
          <RefreshCw
            size={16}
            className={`text-gray-600 ${loadingStage < 5 ? 'animate-spin' : ''}`}
          />
        </button>
        <button
          onClick={onExport}
          className='p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-all'
          title='Export'
          data-track-category='Workflows'
          data-track-name='ExportWorkflow'
        >
          <Download size={16} className='text-gray-600' />
        </button>
        <button
          onClick={toggleFs}
          className='p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-all'
          title={isFullscreen ? 'Exit' : 'Fullscreen'}
          data-track-category='Workflows'
          data-track-name='ToggleWorkflowFullscreen'
        >
          {isFullscreen ? (
            <Minimize2 size={16} className='text-gray-600' />
          ) : (
            <Maximize2 size={16} className='text-gray-600' />
          )}
        </button>
      </div>

      <WorkflowCanvas
        nodes={blendNodes}
        edges={blendEdges}
        onNodesChange={setNodes}
        onEdgesChange={setEdges}
        onConnect={(c: Connection): void => {
          if (c.source && c.target)
            setEdges(p => [
              ...p,
              {
                id: `e${c.source}-${c.target}`,
                source: c.source,
                target: c.target,
                data: { label: '' },
              } as BlendEdge,
            ]);
        }}
        nodeTypes={nodeTypes}
        fitView
        maxZoom={1.3}
        showMinimap
        height='100%'
        showBackground
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      />
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

interface WorkflowGraphOnlyProps {
  workflowType?: string | undefined;
  workflowId?: string | undefined;
  combinedStepsData: CombinedWorkflowData;
  loading?: boolean;
  onRefresh?: () => void;
  onNodeSelect?: (stepId: string | null, workflowStepIds: string[]) => void;
  onExecutionChange?: (newExecutionId: string) => void;
}

export const WorkflowGraphOnly: React.FC<WorkflowGraphOnlyProps> = ({
  workflowType,
  workflowId,
  combinedStepsData,
  onRefresh,
  onNodeSelect,
  onExecutionChange,
}) => {
  const {
    data: astGraph,
    isLoading,
    error,
  } = useWorkflowGraphData(workflowType, Boolean(combinedStepsData));
  const { nodes, edges } = useMemo(
    () =>
      astGraph && combinedStepsData
        ? convertASTGraphToWorkflowUILight(astGraph, combinedStepsData)
        : { nodes: [], edges: [] },
    [astGraph, combinedStepsData],
  );
  const exportData = (): void => {
    void downloadJsonAsCsv(
      JSON.parse(JSON.stringify(combinedStepsData)) as JsonObject,
      `${workflowId ?? 'workflow'}_${new Date().toISOString().split('T')[0]}.csv`,
      undefined,
      workflowId,
    );
  };

  if (isLoading)
    return (
      <div className='h-full flex items-center justify-center bg-white'>
        <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500' />
      </div>
    );
  if (error)
    return (
      <div className='h-full flex items-center justify-center bg-white text-sm text-red-500'>
        Failed to load graph
        {onRefresh && (
          <button
            onClick={onRefresh}
            className='ml-2 px-2 py-1 bg-blue-500 text-white rounded text-xs'
            data-track-category='Workflows'
            data-track-name='RetryLoadGraph'
          >
            Retry
          </button>
        )}
      </div>
    );

  return (
    <ReactFlowProvider>
      <GraphInner
        nodes={nodes}
        edges={edges}
        onRefresh={onRefresh}
        onExport={exportData}
        onNodeSelect={onNodeSelect}
        onExecutionChange={onExecutionChange}
      />
    </ReactFlowProvider>
  );
};

export default WorkflowGraphOnly;
