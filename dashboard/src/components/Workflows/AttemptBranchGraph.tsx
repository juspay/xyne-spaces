import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { GitFork, Loader2 } from 'lucide-react';
import {
  ExecutionMetadata,
  WorkflowStep,
} from '../../services/Workflow/workflowGraphService.types';
import { apiInstance } from '../../services/clients/apiClient';

interface AttemptBranchGraphProps {
  executionMetadata: ExecutionMetadata[];
  selectedExecutionId: string | undefined;
  onExecutionSelect: (executionId: string) => void;
}

interface TreeNode {
  execution: ExecutionMetadata;
  attemptNumber: number;
  column: number;
  parentAttemptNumber: number | null;
  forkStepIndex: number | null;
  startRow: number;
  steps: WorkflowStep[];
}

interface ForkConnection {
  fromColumn: number;
  toColumn: number;
  fromRow: number;
  toRow: number;
}

async function fetchExecutionSteps(executionId: string): Promise<WorkflowStep[]> {
  try {
    const response = await apiInstance.get<{ steps: WorkflowStep[] }>(
      `/workflows/executions/${executionId}/steps`,
    );
    const steps = response.data.steps || [];
    return steps.filter(s => !s.isParallelChild);
  } catch (error) {
    console.error(`Failed to fetch steps for execution ${executionId}:`, error);
    return [];
  }
}

function buildTreeStructure(
  attempts: ExecutionMetadata[],
  stepsMap: Map<string, WorkflowStep[]>,
): { nodes: TreeNode[]; connections: ForkConnection[]; maxRow: number } {
  if (attempts.length === 0) {
    return { nodes: [], connections: [], maxRow: 0 };
  }

  const sorted = [...attempts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const executionToIndex = new Map<string, number>();
  sorted.forEach((a, i) => executionToIndex.set(a.executionId, i));

  const columnAssignments = new Map<number, number>();
  let maxColumn = 0;

  for (let i = sorted.length - 1; i >= 0; i--) {
    const attempt = sorted[i];
    if (!attempt) continue;

    const parentId = attempt.parentWorkflowExecutionId;
    if (!parentId) {
      columnAssignments.set(i, 0);
    } else {
      const parentIdx = executionToIndex.get(parentId);
      if (parentIdx === undefined) {
        columnAssignments.set(i, 0);
      } else {
        const parentCol = columnAssignments.get(parentIdx) ?? 0;
        const isFork = attempt.sourceStepName !== null;

        if (isFork) {
          maxColumn++;
          columnAssignments.set(i, maxColumn);
        } else {
          columnAssignments.set(i, parentCol);
        }
      }
    }
  }

  const tempNodes = sorted.map((execution, i) => {
    const attemptNumber = sorted.length - i;
    const parentId = execution.parentWorkflowExecutionId;
    const parentIdx = parentId ? executionToIndex.get(parentId) : undefined;
    const parentAttemptNumber = parentIdx !== undefined ? sorted.length - parentIdx : null;
    const column = columnAssignments.get(i) ?? 0;
    const steps = stepsMap.get(execution.executionId) || [];

    let forkStepIndex: number | null = null;

    if (parentIdx !== undefined && execution.sourceStepName) {
      const parentExecution = sorted[parentIdx];
      if (parentExecution) {
        const parentSteps = stepsMap.get(parentExecution.executionId) || [];
        forkStepIndex = parentSteps.findIndex(s => s.stepName === execution.sourceStepName);
        if (forkStepIndex === -1) forkStepIndex = null;
      }
    }

    return {
      execution,
      attemptNumber,
      column,
      parentAttemptNumber,
      forkStepIndex,
      startRow: 0,
      steps,
    };
  });

  const startRows = new Map<number, number>();
  tempNodes.forEach(node => {
    if (node.parentAttemptNumber === null) {
      startRows.set(node.column, 0);
    } else if (node.forkStepIndex !== null) {
      startRows.set(node.column, node.forkStepIndex);
    }
  });

  const nodes: TreeNode[] = tempNodes.map(node => ({
    ...node,
    startRow: startRows.get(node.column) ?? 0,
  }));

  const connections: ForkConnection[] = [];
  nodes.forEach(node => {
    if (node.parentAttemptNumber !== null && node.forkStepIndex !== null) {
      const parentNode = nodes.find(n => n.attemptNumber === node.parentAttemptNumber);
      if (parentNode) {
        connections.push({
          fromColumn: parentNode.column,
          toColumn: node.column,
          fromRow: node.forkStepIndex,
          toRow: node.forkStepIndex,
        });
      }
    }
  });

  let maxRow = 0;
  nodes.forEach(node => {
    const endRow = node.startRow + node.steps.length - 1;
    maxRow = Math.max(maxRow, endRow);
  });

  return { nodes, connections, maxRow };
}

function getStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
    case 'SUCCESS':
      return 'bg-emerald-500';
    case 'RUNNING':
    case 'IN_PROGRESS':
      return 'bg-blue-500';
    case 'FAILED':
    case 'ERROR':
      return 'bg-red-500';
    case 'PENDING':
      return 'bg-gray-300';
    default:
      return 'bg-gray-400';
  }
}

const STEP_HEIGHT = 22;

function StepDot({
  status,
  isForkPoint,
  stepName,
  stepNumber,
}: {
  status: string;
  isForkPoint?: boolean;
  stepName?: string | null;
  stepNumber?: number;
}): React.ReactElement {
  const statusColor = getStatusColor(status);

  return (
    <div className='flex items-center gap-2 group' style={{ height: `${STEP_HEIGHT}px` }}>
      <div
        className={`w-2.5 h-2.5 rounded-full ${statusColor} ${
          isForkPoint ? 'ring-2 ring-amber-400' : ''
        } transition-all flex-shrink-0`}
        title={stepName || `Step ${stepNumber}`}
      />
      {stepName && (
        <span className='text-[10px] text-muted-foreground truncate max-w-[100px] opacity-0 group-hover:opacity-100 transition-opacity'>
          {stepName}
        </span>
      )}
    </div>
  );
}

const AttemptBranchGraph: React.FC<AttemptBranchGraphProps> = ({
  executionMetadata,
  selectedExecutionId,
  onExecutionSelect,
}) => {
  const [stepsMap, setStepsMap] = useState<Map<string, WorkflowStep[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllSteps = async () => {
      setLoading(true);
      const newStepsMap = new Map<string, WorkflowStep[]>();

      const fetchPromises = executionMetadata.map(async meta => {
        const steps = await fetchExecutionSteps(meta.executionId);
        const stepsByName = new Map<string, WorkflowStep>();
        steps.forEach(step => {
          const name = step.stepName || 'Unknown';
          if (!stepsByName.has(name)) {
            stepsByName.set(name, step);
          }
        });
        const uniqueSteps = steps.filter(s => stepsByName.get(s.stepName || 'Unknown') === s);
        return { executionId: meta.executionId, steps: uniqueSteps };
      });

      const results = await Promise.all(fetchPromises);
      results.forEach(({ executionId, steps }) => {
        newStepsMap.set(executionId, steps);
      });

      setStepsMap(newStepsMap);
      setLoading(false);
    };

    void fetchAllSteps();
  }, [executionMetadata]);

  const { nodes, connections, maxRow } = useMemo(
    () => buildTreeStructure(executionMetadata, stepsMap),
    [executionMetadata, stepsMap],
  );

  if (nodes.length === 0 || loading) {
    return (
      <div className='flex items-center justify-center p-8'>
        <Loader2 size={20} className='animate-spin text-muted-foreground' />
      </div>
    );
  }

  const columnWidth = 160;
  const maxColumn = Math.max(...nodes.map(n => n.column), 0);
  const totalWidth = (maxColumn + 1) * columnWidth;

  return (
    <div className='flex flex-col' style={{ maxHeight: '60vh' }}>
      <div className='overflow-auto flex-1'>
        <div style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
          {/* Header */}
          <div className='flex border-b border-border bg-muted px-3 py-2 sticky top-0 z-10'>
            {nodes
              .sort((a, b) => a.column - b.column)
              .map(node => (
                <div
                  key={`header-${node.execution.executionId}`}
                  className='px-2'
                  style={{ width: `${columnWidth}px`, flex: 'none' }}
                >
                  <span className='text-sm font-medium'>Attempt {node.attemptNumber}</span>
                  {node.execution.tag === 'root' && (
                    <span className='text-muted-foreground text-xs ml-1'>(original)</span>
                  )}
                </div>
              ))}
          </div>

          {/* Tree content */}
          <div
            className='relative p-3'
            style={{ minHeight: `${(maxRow + 1) * STEP_HEIGHT + 80}px` }}
          >
            {/* Fork connection lines */}
            <svg
              className='absolute inset-0 pointer-events-none'
              style={{
                width: `${totalWidth}px`,
                height: `${(maxRow + 1) * STEP_HEIGHT + 80}px`,
                minWidth: '100%',
              }}
            >
              {connections.map((conn, idx) => {
                const fromX = conn.fromColumn * columnWidth + 5;
                const toX = conn.toColumn * columnWidth + 5;
                const y = conn.fromRow * STEP_HEIGHT + STEP_HEIGHT / 2;

                return (
                  <g key={`conn-${idx}`}>
                    <line
                      x1={fromX}
                      y1={y}
                      x2={toX - 8}
                      y2={y}
                      stroke='var(--status-pending)'
                      strokeWidth='2'
                    />
                    <polygon
                      points={`${toX - 8},${y - 4} ${toX},${y} ${toX - 8},${y + 4}`}
                      fill='var(--status-pending)'
                    />
                    <circle
                      cx={fromX}
                      cy={y}
                      r='3'
                      fill='var(--status-pending)'
                      stroke='var(--sidebar)'
                      strokeWidth='1'
                    />
                  </g>
                );
              })}
            </svg>

            {/* Columns */}
            <div className='flex' style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
              {nodes
                .sort((a, b) => a.column - b.column)
                .map(node => {
                  const isSelected = node.execution.executionId === selectedExecutionId;
                  const isFork =
                    node.parentAttemptNumber !== null && node.execution.sourceStepName !== null;

                  return (
                    <div
                      key={node.execution.executionId}
                      className='flex flex-col'
                      style={{ width: `${columnWidth}px`, flex: 'none' }}
                    >
                      {/* Steps */}
                      <div
                        className='flex flex-col'
                        style={{ marginTop: `${node.startRow * STEP_HEIGHT}px` }}
                      >
                        {node.steps.length === 0 ? (
                          <div
                            className='flex items-center gap-2'
                            style={{ height: `${STEP_HEIGHT}px` }}
                          >
                            <div
                              className={`w-2.5 h-2.5 rounded-full ${getStatusColor(node.execution.executionStatus)}`}
                            />
                            <span className='text-[10px] text-muted-foreground'>
                              {node.execution.executionStatus}
                            </span>
                          </div>
                        ) : (
                          node.steps.map((step, stepIdx) => {
                            const isForkPoint = isFork && stepIdx === 0;

                            return (
                              <StepDot
                                key={step.id}
                                status={step.status || 'PENDING'}
                                isForkPoint={isForkPoint}
                                stepName={step.stepName}
                                stepNumber={stepIdx + 1}
                              />
                            );
                          })
                        )}
                      </div>

                      {/* Attempt info card */}
                      <button
                        onClick={() => onExecutionSelect(node.execution.executionId)}
                        className={`mt-4 p-2.5 rounded-lg border text-left transition-all hover:shadow-md ${
                          isSelected
                            ? 'bg-blue-50/50 border-blue-300 ring-1 ring-blue-300'
                            : 'bg-background border-border hover:border-border/80'
                        }`}
                        style={{ marginTop: 'auto' }}
                        data-track-category='Workflows'
                        data-track-name='SelectAttemptFromBranchGraph'
                      >
                        <div className='flex items-center gap-2'>
                          <div
                            className={`w-2 h-2 rounded-full ${getStatusColor(node.execution.executionStatus)}`}
                          />
                          <span className='font-medium text-sm'>Attempt {node.attemptNumber}</span>
                          {isSelected && (
                            <span className='text-[10px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-medium'>
                              current
                            </span>
                          )}
                        </div>

                        {isFork && node.parentAttemptNumber && node.execution.sourceStepName && (
                          <>
                            <div className='flex items-center gap-1 text-[10px] mt-1.5'>
                              <GitFork size={10} className='text-amber-500' />
                              <span className='text-amber-700 dark:text-amber-400'>
                                from Attempt {node.parentAttemptNumber}
                              </span>
                            </div>
                            <div className='mt-1.5'>
                              <span className='text-[9px] bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1 py-0.5 rounded border border-amber-200 dark:border-amber-800 break-words inline-block max-w-full'>
                                at: {node.execution.sourceStepName}
                              </span>
                            </div>
                          </>
                        )}

                        <div className='flex items-center gap-1 text-[10px] text-muted-foreground mt-1.5'>
                          <span>{format(new Date(node.execution.createdAt), 'MMM d, h:mm a')}</span>
                        </div>
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttemptBranchGraph;
