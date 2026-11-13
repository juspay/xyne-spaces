import { useCallback } from 'react';
import type { WorkflowStepConfig, StepGroup } from '@xyne/workflow-sdk/builder';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import type { StepMeta } from '../../hooks/use-step-metadata.js';
import type { StepExecutionState } from '../../utils/step-state.js';
import type { ActivityEvent } from '../../hooks/use-execution-viewer.js';
import { detectBranchesFromConfig } from '../../utils/branch-detection.js';
import { StepNode } from '../builder/v3/StepNode.js';
import { Connector } from '../builder/v3/Connector.js';
import { BranchContainer } from '../builder/v3/BranchContainer.js';
import { LoopContainer } from '../builder/v3/LoopContainer.js';
import { MapContainer } from './MapContainer.js';
import { GroupContainer } from '../builder/v3/GroupContainer.js';
import { layoutStepsWithGroups } from '../../utils/group-layout.js';
import { cn } from '../shared/cn.js';

type ExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped';

function StatusBadge({ status }: { status: ExecutionStepStatus }) {
  if (status === 'pending') return null;

  const config: Record<string, { bg: string; icon: React.ReactNode }> = {
    completed: {
      bg: 'bg-emerald-500',
      icon: (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ),
    },
    failed: {
      bg: 'bg-red-500',
      icon: (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ),
    },
    running: {
      bg: 'bg-blue-500 animate-pulse',
      icon: (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="white">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      ),
    },
    paused: {
      bg: 'bg-amber-500',
      icon: (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="white">
          <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      ),
    },
    skipped: {
      bg: 'bg-slate-400',
      icon: (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
          <path d="M5 12h14" />
        </svg>
      ),
    },
  };

  const c = config[status];
  if (!c) return null;

  return (
    <span className={cn(
      'absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white',
      c.bg,
    )}>
      {c.icon}
    </span>
  );
}

export interface ExecutionTreeProps {
  steps: WorkflowStepConfig[];
  stepMeta: Map<string, StepMeta>;
  stepStates: Map<string, StepExecutionState>;
  selectedStepId: string | null;
  onStepClick: (stepId: string) => void;
  /** Documentation groups — threaded through to branch/loop sub-trees so nested steps render their group boxes too. */
  groups?: StepGroup[] | undefined;
  stepEvents?: Map<string, ActivityEvent[]> | undefined;
  /** Raw execution records — threaded down so MAP steps can derive their dynamic per-iteration lanes. */
  executionSteps?: ExecutionDetail['steps'] | undefined;
  /**
   * Node-path frame prefixed onto each step's id to form its selection id. Set
   * for MAP iteration lanes (`owners_map:item#0/`) so the same body step in
   * different lanes selects DIFFERENT records; undefined at the top level (ids
   * stay bare). Inherited unchanged by branch/loop sub-trees.
   */
  selectionPrefix?: string | undefined;
}

function activityLine(event: ActivityEvent | undefined): string | undefined {
  if (!event) return undefined;
  const data = event.data as Record<string, unknown> | undefined;
  switch (event.type) {
    case 'tool_call': {
      const tool = typeof data?.['tool'] === 'string' ? data['tool'] : 'tool';
      return data?.['phase'] === 'end' ? `🔧 ${tool} ✓` : `🔧 ${tool}…`;
    }
    case 'thinking':
      return '💭 thinking…';
    case 'progress':
    case 'substep': {
      const text = typeof data?.['content'] === 'string' ? data['content']
        : typeof data?.['message'] === 'string' ? data['message'] : '';
      return text ? `💬 ${text.slice(0, 60)}` : '💬 …';
    }
    default:
      return undefined;
  }
}

export function ExecutionTree({
  steps,
  stepMeta,
  stepStates,
  selectedStepId,
  onStepClick,
  groups,
  stepEvents,
  executionSteps,
  selectionPrefix,
}: ExecutionTreeProps) {

  const getBranches = useCallback((step: WorkflowStepConfig) => {
    const meta = stepMeta.get(step.type);
    if (!step.config || typeof step.config !== 'object') return {};
    return detectBranchesFromConfig(
      step.config as Record<string, unknown>,
      meta?.configSchema,
    );
  }, [stepMeta]);

  const renderSteps = useCallback((branchSteps: WorkflowStepConfig[], suppressTrailing?: Set<string>) => {
    return branchSteps.map((step, i) => {
      const meta = stepMeta.get(step.type);
      // MAP lanes prefix the id with the iteration frame so each lane's copy of
      // a body step is independently selectable; bare id everywhere else.
      const selectionId = selectionPrefix ? `${selectionPrefix}${step.id}` : step.id;
      const isSelected = selectedStepId === selectionId;
      const state = stepStates.get(step.id);
      const status: ExecutionStepStatus = (state?.status as ExecutionStepStatus) ?? 'pending';
      const branches = getBranches(step);
      const branchEntries = Object.entries(branches);
      const hasBranches = branchEntries.length > 0;
      const isLoop = meta?.branchModel === 'iterate';
      const isMap = meta?.branchModel === 'map';
      const isLastStep = i === branchSteps.length - 1;
      const events = stepEvents?.get(step.id);
      const liveActivity = status === 'running' && events?.length
        ? activityLine(events[events.length - 1])
        : undefined;

      return (
        <div key={step.id} className="flex flex-col items-center">
          {/* Step node with execution status styling */}
          <div className="relative">
            <StepNode
              stepId={step.id}
              label={step.title || meta?.name || step.type}
              description={step.description}
              category={step.title ? undefined : meta?.category}
              icon={meta?.icon}
              isSelected={isSelected}
              isDisabled={status === 'skipped'}
              executionStatus={status}
              liveActivity={liveActivity}
              readOnly
              onClick={() => onStepClick(selectionId)}
            />
            {/* Status badge overlaid on icon */}
            <div className="absolute left-3 top-3">
              <div className="relative h-8 w-8">
                <StatusBadge status={status} />
              </div>
            </div>
          </div>

          {/* Branch rendering */}
          {hasBranches && (
            <>
              <div className="h-4 w-px bg-slate-300" />
              {isMap ? (
                <MapContainer
                  mapStepId={step.id}
                  records={executionSteps}
                  category={meta?.category}
                  label={meta?.name ?? step.type}
                  renderLane={(laneStates, laneRecords, _index, prefix) => (
                    <ExecutionTree
                      steps={branchEntries[0]![1].steps}
                      stepMeta={stepMeta}
                      stepStates={laneStates}
                      selectedStepId={selectedStepId}
                      onStepClick={onStepClick}
                      groups={groups}
                      stepEvents={stepEvents}
                      executionSteps={laneRecords}
                      selectionPrefix={prefix}
                    />
                  )}
                />
              ) : isLoop ? (
                <LoopContainer
                  category={meta?.category}
                  bodySteps={branchEntries[0]![1].steps}
                  renderBody={(bodySteps) => (
                    <ExecutionTree
                      steps={bodySteps}
                      stepMeta={stepMeta}
                      stepStates={stepStates}
                      selectedStepId={selectedStepId}
                      onStepClick={onStepClick}
                      groups={groups}
                      stepEvents={stepEvents}
                      executionSteps={executionSteps}
                      selectionPrefix={selectionPrefix}
                    />
                  )}
                />
              ) : (
                <BranchContainer
                  stepId={step.id}
                  branches={branches}
                  category={meta?.category}
                  label={meta?.name ?? step.type}
                  readOnly
                  renderBranch={(_branchKey, branchSteps2) => (
                    <ExecutionTree
                      steps={branchSteps2}
                      stepMeta={stepMeta}
                      stepStates={stepStates}
                      selectedStepId={selectedStepId}
                      onStepClick={onStepClick}
                      groups={groups}
                      stepEvents={stepEvents}
                      executionSteps={executionSteps}
                      selectionPrefix={selectionPrefix}
                    />
                  )}
                />
              )}
            </>
          )}

          {/* Connector between steps (no add button — read-only).
              Suppressed at a group's lower boundary — rendered outside the box instead. */}
          {!isLastStep && !suppressTrailing?.has(step.id) && <Connector />}
        </div>
      );
    });
  }, [stepMeta, stepStates, selectedStepId, groups, stepEvents, executionSteps, selectionPrefix, getBranches, onStepClick]);

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="text-[11px] text-slate-400 italic">No steps</div>
      </div>
    );
  }

  // Wrap contiguous runs sharing a `groupId` in a GroupContainer (read-only) so
  // a run looks structurally identical to the builder. `groups` is threaded into
  // branch/loop sub-trees, so nested groups render at every level.
  if (groups && groups.length > 0) {
    return (
      <>
        {layoutStepsWithGroups({
          steps,
          groups,
          renderElements: (suppress) => renderSteps(steps, suppress),
          renderGroup: (group, children, key) => (
            <GroupContainer key={key} title={group.title} description={group.description}>
              {children}
            </GroupContainer>
          ),
          renderBoundaryConnector: (_lastStepId, key) => <Connector key={key} />,
        })}
      </>
    );
  }

  return <>{renderSteps(steps)}</>;
}
