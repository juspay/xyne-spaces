import type { Ref } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { ValidationIssue } from '@xyne/workflow-sdk';
import type { StepMeta, TriggerMeta } from '../../../hooks/use-step-metadata.js';
import { TriggerNode } from './TriggerNode.js';
import { Connector } from './Connector.js';
import { WorkflowTree } from './WorkflowTree.js';
import { TerminalNode } from './TerminalNode.js';

export interface WorkflowCanvasProps {
  config: WorkflowConfig;
  stepMeta: Map<string, StepMeta>;
  triggerMeta: TriggerMeta[];
  selectedStepId: string | null;
  isTriggerSelected: boolean;
  isTriggerConfigured: boolean;
  readOnly: boolean;
  zoom?: number | undefined;
  scrollRef?: Ref<HTMLDivElement> | undefined;
  onTriggerClick: () => void;
  onStepClick: (stepId: string) => void;
  onAddStep: (afterStepId?: string, inBranch?: { stepId: string; branchKey: string }) => void;
  onCanvasClick: () => void;
  onDeleteStep: (stepId: string) => void;
  onDuplicateStep: (stepId: string) => void;
  onToggleStepDisabled: (stepId: string) => void;
  onAddBranch: (stepId: string, container: string, name: string) => void;
  onRenameBranch: (stepId: string, container: string, oldName: string, newName: string) => void;
  onUpdateGroup?: ((groupId: string, patch: { title?: string; description?: string }) => void) | undefined;
  /** Validation issues per step id (builder mode). */
  issuesByStep?: Map<string, ValidationIssue[]> | undefined;
  /** Whether the trigger has validation issues. */
  triggerHasIssues?: boolean | undefined;
}

export function WorkflowCanvas({
  config,
  stepMeta,
  triggerMeta,
  selectedStepId,
  isTriggerSelected,
  isTriggerConfigured,
  readOnly,
  zoom = 1,
  scrollRef,
  onTriggerClick,
  onStepClick,
  onAddStep,
  onCanvasClick,
  onDeleteStep,
  onDuplicateStep,
  onToggleStepDisabled,
  onAddBranch,
  onRenameBranch,
  onUpdateGroup,
  issuesByStep,
  triggerHasIssues,
}: WorkflowCanvasProps) {
  const triggerInfo = triggerMeta.find((t) => t.type === config.trigger.type);
  // No step editing allowed until a trigger is configured
  const effectiveReadOnly = readOnly || !isTriggerConfigured;

  return (
    <div
      ref={scrollRef}
      data-testid="canvas-scroll"
      className="h-full w-full overflow-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCanvasClick();
      }}
    >
      {/* Dot grid background */}
      <div
        className="flex w-max min-h-full min-w-full items-start p-12"
        style={{
          justifyContent: 'safe center',
          backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onCanvasClick();
        }}
      >
        {/* Centered vertical flow with zoom */}
        <div
          className="flex flex-col items-center transition-transform duration-150"
          style={{
            width: 'max-content',
            transformOrigin: zoom > 1 ? 'top left' : 'top center',
            transform: `scale(${zoom})`,
          }}
        >
          {/* Trigger */}
          <TriggerNode
            label={triggerInfo?.name ?? (isTriggerConfigured ? config.trigger.type : undefined)}
            icon={triggerInfo?.icon}
            isSelected={isTriggerSelected}
            isConfigured={isTriggerConfigured}
            hasIssues={triggerHasIssues}
            onClick={onTriggerClick}
          />

          {/* Connector from trigger to first step */}
          <Connector
            showAddButton={!effectiveReadOnly}
            onAdd={() => onAddStep()}
          />

          {/* Recursive workflow tree */}
          {config.steps.length > 0 && (
            <>
              <WorkflowTree
                steps={config.steps}
                stepMeta={stepMeta}
                selectedStepId={selectedStepId}
                readOnly={effectiveReadOnly}
                groups={config.groups}
                onUpdateGroup={onUpdateGroup}
                issuesByStep={issuesByStep}
                onStepClick={onStepClick}
                onAddStep={onAddStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                onToggleStepDisabled={onToggleStepDisabled}
                onAddBranch={onAddBranch}
                onRenameBranch={onRenameBranch}
              />

              {/* Connector after last step */}
              <Connector
                showAddButton={!effectiveReadOnly}
                onAdd={() => {
                  const lastStep = config.steps[config.steps.length - 1];
                  if (lastStep) onAddStep(lastStep.id);
                }}
              />
            </>
          )}

          {/* Terminal */}
          <TerminalNode />
        </div>
      </div>
    </div>
  );
}
