import { useCallback } from 'react';
import type { WorkflowStepConfig, StepGroup } from '@xyne/workflow-sdk/builder';
import type { ValidationIssue } from '@xyne/workflow-sdk';
import type { StepMeta } from '../../../hooks/use-step-metadata.js';
import { detectBranchesFromConfig } from '../../../utils/branch-detection.js';
import { StepNode } from './StepNode.js';
import { Connector } from './Connector.js';
import { BranchContainer } from './BranchContainer.js';
import { LoopContainer } from './LoopContainer.js';
import { GroupContainer } from './GroupContainer.js';
import { layoutStepsWithGroups } from '../../../utils/group-layout.js';

export interface WorkflowTreeProps {
  steps: WorkflowStepConfig[];
  stepMeta: Map<string, StepMeta>;
  selectedStepId: string | null;
  readOnly: boolean;
  /** Documentation groups — threaded through to branch/loop sub-trees so nested steps can be grouped too. */
  groups?: StepGroup[] | undefined;
  /** Edit a group's title/description (inline, builder only). */
  onUpdateGroup?: ((groupId: string, patch: { title?: string; description?: string }) => void) | undefined;
  /** Validation issues per step id — renders a red badge on affected nodes. */
  issuesByStep?: Map<string, ValidationIssue[]> | undefined;
  /** Show a trailing "+" connector after the last step (used inside branches/loops). */
  showTrailingAdd?: boolean | undefined;
  onStepClick: (stepId: string) => void;
  onAddStep: (afterStepId?: string, inBranch?: { stepId: string; branchKey: string }) => void;
  onDeleteStep: (stepId: string) => void;
  onDuplicateStep: (stepId: string) => void;
  onToggleStepDisabled: (stepId: string) => void;
  onAddBranch: (stepId: string, container: string, name: string) => void;
  onRenameBranch: (stepId: string, container: string, oldName: string, newName: string) => void;
}

export function WorkflowTree({
  steps,
  stepMeta,
  selectedStepId,
  readOnly,
  groups,
  onUpdateGroup,
  issuesByStep,
  showTrailingAdd,
  onStepClick,
  onAddStep,
  onDeleteStep,
  onDuplicateStep,
  onToggleStepDisabled,
  onAddBranch,
  onRenameBranch,
}: WorkflowTreeProps) {

  /** Detect branches for a step using its config + configSchema from metadata */
  const getBranches = useCallback((step: WorkflowStepConfig) => {
    const meta = stepMeta.get(step.type);
    if (!step.config || typeof step.config !== 'object') return {};
    return detectBranchesFromConfig(
      step.config as Record<string, unknown>,
      meta?.configSchema,
    );
  }, [stepMeta]);

  /** Detect which config key holds a dynamic branch record (for PARALLEL's "Add Branch") */
  const getDynamicContainer = useCallback((step: WorkflowStepConfig) => {
    const meta = stepMeta.get(step.type);
    if (!meta?.configSchema) return undefined;
    const properties = (meta.configSchema as Record<string, unknown>)['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (!properties) return undefined;
    for (const [key, propSchema] of Object.entries(properties)) {
      if (propSchema['type'] === 'object') {
        const additionalProps = propSchema['additionalProperties'] as Record<string, unknown> | undefined;
        if (additionalProps?.['type'] === 'array') {
          const items = additionalProps['items'] as Record<string, unknown> | undefined;
          if (items?.['type'] === 'object') return key;
        }
      }
    }
    return undefined;
  }, [stepMeta]);

  /** Recursive render for a branch's steps. `suppressTrailing` omits the trailing
   *  connector for the given step ids (used at group boundaries, where the
   *  connector is rendered outside the group box instead). */
  const renderSteps = useCallback((branchSteps: WorkflowStepConfig[], suppressTrailing?: Set<string>) => {
    return branchSteps.map((step, i) => {
      const meta = stepMeta.get(step.type);
      const isSelected = selectedStepId === step.id;
      const isDisabled = Boolean((step.config as Record<string, unknown> | undefined)?.['disabled']);
      const branches = getBranches(step);
      const branchEntries = Object.entries(branches);
      const hasBranches = branchEntries.length > 0;
      // Loop vs fanout is a property of the step type (LOOP iterates; CONDITIONAL/
      // SWITCH/PARALLEL fan out), not of the current branch count. A SWITCH with
      // only `default` is still a fanout — render it as a single-lane fork.
      // LOOP iterates sequentially; MAP fans the same single body out concurrently
      // per item. Both edit as one body (unlike CONDITIONAL/SWITCH/PARALLEL lanes).
      const isLoop = meta?.branchModel === 'iterate';
      const isMap = meta?.branchModel === 'map';
      const isSingleBody = isLoop || isMap;
      const isLastStep = i === branchSteps.length - 1;
      const stepIssues = issuesByStep?.get(step.id);

      return (
        <div key={step.id} className="flex flex-col items-center">
          {/* The step node itself */}
          <StepNode
            stepId={step.id}
            label={step.title || meta?.name || step.type}
            description={step.description}
            category={step.title ? undefined : meta?.category}
            icon={meta?.icon}
            isSelected={isSelected}
            isDisabled={isDisabled}
            readOnly={readOnly}
            issueCount={stepIssues?.length}
            issueTitle={stepIssues?.map((iss) => iss.message).join('\n')}
            onClick={() => onStepClick(step.id)}
            onDelete={() => onDeleteStep(step.id)}
            onDuplicate={() => onDuplicateStep(step.id)}
            onToggleDisabled={() => onToggleStepDisabled(step.id)}
          />

          {/* Branch rendering */}
          {hasBranches && (
            <>
              <div className="h-4 w-px bg-slate-300" />
              {isSingleBody ? (
                // LOOP (iterating) / MAP (concurrent) — both edit a single body
                <LoopContainer
                  category={meta?.category}
                  label={isMap ? 'Maps (concurrent)' : 'Iterates'}
                  bodySteps={branchEntries[0]![1].steps}
                  renderBody={(bodySteps) => (
                    <WorkflowTree
                      steps={bodySteps}
                      stepMeta={stepMeta}
                      selectedStepId={selectedStepId}
                      readOnly={readOnly}
                      groups={groups}
                      onUpdateGroup={onUpdateGroup}
                      issuesByStep={issuesByStep}
                      showTrailingAdd
                      onStepClick={onStepClick}
                      onAddStep={(afterId, inBranch) => onAddStep(afterId, inBranch ?? { stepId: step.id, branchKey: branchEntries[0]![0] })}
                      onDeleteStep={onDeleteStep}
                      onDuplicateStep={onDuplicateStep}
                      onToggleStepDisabled={onToggleStepDisabled}
                      onAddBranch={onAddBranch}
                      onRenameBranch={onRenameBranch}
                    />
                  )}
                />
              ) : (
                // Fanout — CONDITIONAL / SWITCH / PARALLEL — render lanes even if only one exists
                <BranchContainer
                  stepId={step.id}
                  branches={branches}
                  category={meta?.category}
                  label={meta?.name ?? step.type}
                  dynamicContainer={getDynamicContainer(step)}
                  readOnly={readOnly}
                  onAddBranch={(name) => {
                    const container = getDynamicContainer(step);
                    if (container) onAddBranch(step.id, container, name);
                  }}
                  onRenameBranch={(oldName, newName) => {
                    const container = getDynamicContainer(step);
                    if (container) onRenameBranch(step.id, container, oldName, newName);
                  }}
                  renderBranch={(branchKey, branchSteps) => (
                    <WorkflowTree
                      steps={branchSteps}
                      stepMeta={stepMeta}
                      selectedStepId={selectedStepId}
                      readOnly={readOnly}
                      groups={groups}
                      onUpdateGroup={onUpdateGroup}
                      issuesByStep={issuesByStep}
                      showTrailingAdd
                      onStepClick={onStepClick}
                      onAddStep={(afterId, inBranch) => onAddStep(afterId, inBranch ?? { stepId: step.id, branchKey })}
                      onDeleteStep={onDeleteStep}
                      onDuplicateStep={onDuplicateStep}
                      onToggleStepDisabled={onToggleStepDisabled}
                      onAddBranch={onAddBranch}
                      onRenameBranch={onRenameBranch}
                    />
                  )}
                />
              )}
            </>
          )}

          {/* Connector between steps (and after last step when inside a branch/loop).
              Suppressed at a group's lower boundary — rendered outside the box instead. */}
          {(!isLastStep || showTrailingAdd) && !suppressTrailing?.has(step.id) && (
            <Connector
              showAddButton={!readOnly}
              onAdd={() => onAddStep(step.id)}
            />
          )}
        </div>
      );
    });
  }, [stepMeta, selectedStepId, readOnly, groups, onUpdateGroup, issuesByStep, getBranches, getDynamicContainer, onStepClick, onAddStep, onDeleteStep, onDuplicateStep, onToggleStepDisabled, onAddBranch, onRenameBranch]);

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="text-[11px] text-slate-400 italic">No steps</div>
        {!readOnly && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddStep(undefined); }}
            className="mt-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
            title="Add step"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // Wrap contiguous runs of steps sharing a `groupId` in a GroupContainer. This
  // runs at every level — `groups` is now threaded into branch/loop sub-trees,
  // so each sub-tree independently wraps its own contiguous runs.
  if (groups && groups.length > 0) {
    return (
      <>
        {layoutStepsWithGroups({
          steps,
          groups,
          showTrailingAdd,
          renderElements: (suppress) => renderSteps(steps, suppress),
          renderGroup: (group, children, key) => (
            <GroupContainer
              key={key}
              title={group.title}
              description={group.description}
              editable={!readOnly && !!onUpdateGroup}
              onUpdate={onUpdateGroup ? (patch) => onUpdateGroup(group.id, patch) : undefined}
            >
              {children}
            </GroupContainer>
          ),
          renderBoundaryConnector: (lastStepId, key) => (
            <Connector key={key} showAddButton={!readOnly} onAdd={() => onAddStep(lastStepId)} />
          ),
        })}
      </>
    );
  }

  return <>{renderSteps(steps)}</>;
}
