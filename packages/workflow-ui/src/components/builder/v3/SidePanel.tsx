import type { TriggerFilter, TriggerStart, WorkflowConfig, WorkflowRunNaming, WorkflowStepConfig, WorkflowVariable } from '@xyne/workflow-sdk/builder';
import type { ValidationIssue } from '@xyne/workflow-sdk';
import type { StepMeta, TriggerMeta } from '../../../hooks/use-step-metadata.js';
import { StepConfigPanel } from './StepConfigPanel.js';
import { TriggerConfigPanel } from './TriggerConfigPanel.js';
import { VariablesPanel } from './VariablesPanel.js';
import { cn } from '../../shared/cn.js';

export interface SidePanelProps {
  /** The currently selected step, or null. */
  selectedStep: WorkflowStepConfig | null;
  /** Whether the trigger node is selected. */
  isTriggerSelected: boolean;
  /** Whether the workflow-variables panel is selected. */
  isVariablesSelected: boolean;
  /** The workflow's author-time variables (for the variables panel). */
  variables: WorkflowVariable[];
  onUpdateVariables: (next: WorkflowVariable[]) => void;
  /** Full workflow config — passed to variable picker for scope resolution. */
  config: WorkflowConfig;
  /** Metadata map for step types. */
  stepMeta: Map<string, StepMeta>;
  /** Trigger metadata list. */
  triggerMeta: TriggerMeta[];
  /** Current trigger type. */
  triggerType: string;
  /** Current trigger config. */
  triggerConfig: Record<string, unknown>;
  /** Current trigger filter, if any. */
  triggerFilter?: TriggerFilter | undefined;
  /** When a matching event becomes a run. Absent means as soon as it arrives. */
  triggerStart?: TriggerStart | undefined;
  /** The saved workflow's id, for its webhook URL. */
  workflowId?: string | undefined;
  readOnly: boolean;
  /** Validation issues for the selected step (field errors + whole-step list). */
  issues?: ValidationIssue[] | undefined;
  /** Validation issues for the trigger (when the trigger is selected). */
  triggerIssues?: ValidationIssue[] | undefined;
  onUpdateStepConfig: (stepId: string, config: Record<string, unknown>) => void;
  onUpdateStepMeta: (stepId: string, meta: { title?: string; description?: string; groupId?: string | null }) => void;
  onUpsertGroup: (group: import('@xyne/workflow-sdk/builder').StepGroup) => void;
  onAddStepCitation: (stepId: string, fieldPath: string, citation: import('@xyne/workflow-sdk/builder').Citation) => void;
  onRemoveStepCitation: (stepId: string, citationPath: string, index: number) => void;
  onDeleteStep: (stepId: string) => void;
  onDuplicateStep: (stepId: string) => void;
  /** Insert a new step directly above this one. */
  onAddStepAbove: (stepId: string) => void;
  onToggleStepDisabled: (stepId: string) => void;
  onUpdateTriggerConfig: (config: Record<string, unknown>) => void;
  onUpdateRunNaming: (runNaming: WorkflowRunNaming | undefined) => void;
  onUpdateTriggerFilter: (filter: TriggerFilter | undefined) => void;
  onUpdateTriggerStart: (start: TriggerStart | undefined) => void;
  onRequestChangeTrigger: () => void;
  onClose: () => void;
}

export function SidePanel({
  selectedStep,
  isTriggerSelected,
  isVariablesSelected,
  variables,
  onUpdateVariables,
  config,
  stepMeta,
  triggerMeta,
  triggerType,
  triggerConfig,
  triggerFilter,
  triggerStart,
  workflowId,
  readOnly,
  issues,
  triggerIssues,
  onUpdateStepConfig,
  onUpdateStepMeta,
  onUpsertGroup,
  onAddStepCitation,
  onRemoveStepCitation,
  onDeleteStep,
  onDuplicateStep,
  onAddStepAbove,
  onToggleStepDisabled,
  onUpdateTriggerConfig,
  onUpdateRunNaming,
  onUpdateTriggerFilter,
  onUpdateTriggerStart,
  onRequestChangeTrigger,
  onClose,
}: SidePanelProps) {
  const isOpen = !!selectedStep || isTriggerSelected || isVariablesSelected;
  const meta = selectedStep ? stepMeta.get(selectedStep.type) : undefined;

  return (
    <div
      className={cn(
        'relative flex h-full flex-col border-l border-slate-200/80 bg-white transition-[flex,opacity] duration-200',
        isOpen ? 'opacity-100' : 'opacity-0 overflow-hidden border-l-0',
      )}
      style={{
        flex: isOpen ? '0 0 45%' : '0 0 0%',
        animation: isOpen ? 'wui-slide-in-right 180ms ease-out' : undefined,
      }}
    >
      {isOpen && (
        <>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>

          {/* Content */}
          {selectedStep ? (
            <StepConfigPanel
              key={selectedStep.id}
              step={selectedStep}
              config={config}
              workflowId={workflowId}
              category={meta?.category}
              icon={meta?.icon}
              onUpdateConfig={(stepConfig) => onUpdateStepConfig(selectedStep.id, stepConfig)}
              onUpdateMeta={(metaUpdate) => onUpdateStepMeta(selectedStep.id, metaUpdate)}
              groups={config.groups}
              onUpsertGroup={onUpsertGroup}
              onAddCitation={(fieldPath, citation) => onAddStepCitation(selectedStep.id, fieldPath, citation)}
              onRemoveCitation={(citationPath, index) => onRemoveStepCitation(selectedStep.id, citationPath, index)}
              issues={issues}
              onDelete={() => onDeleteStep(selectedStep.id)}
              onDuplicate={() => onDuplicateStep(selectedStep.id)}
              onAddAbove={() => onAddStepAbove(selectedStep.id)}
              onToggleDisabled={() => onToggleStepDisabled(selectedStep.id)}
              readOnly={readOnly}
            />
          ) : isTriggerSelected ? (
            <TriggerConfigPanel
              triggerType={triggerType}
              triggerConfig={triggerConfig}
              triggerMeta={triggerMeta}
              issues={triggerIssues}
              onUpdateConfig={onUpdateTriggerConfig}
              onUpdateRunNaming={onUpdateRunNaming}
              filter={triggerFilter}
              onUpdateFilter={onUpdateTriggerFilter}
              start={triggerStart}
              onUpdateStart={onUpdateTriggerStart}
              workflowConfig={config}
              workflowId={workflowId}
              onRequestChangeTrigger={onRequestChangeTrigger}
              readOnly={readOnly}
            />
          ) : isVariablesSelected ? (
            <VariablesPanel
              variables={variables}
              onChange={onUpdateVariables}
              readOnly={readOnly}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
