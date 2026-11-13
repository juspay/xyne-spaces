/**
 * @xyne/workflow-ui/hooks — headless hooks layer.
 *
 * Pure logic, zero UI, zero CSS. Consumers who want custom UI
 * use these hooks for all state management and API calls.
 */

// ─── Client access ───
export { useWorkflowClient } from './use-workflow-client.js';

// ─── Core state ───
export { useUndoRedo } from './use-undo-redo.js';
export type { UseUndoRedoReturn } from './use-undo-redo.js';

export { useWorkflowBuilder } from './use-workflow-builder.js';
export type { UseWorkflowBuilderOptions, UseWorkflowBuilderReturn } from './use-workflow-builder.js';

export { useSchemaForm } from './use-schema-form.js';
export type { UseSchemaFormOptions, UseSchemaFormReturn, SchemaFormField } from './use-schema-form.js';
export { resolveLayout, normalizeLayout, layoutToSchemaValue, applyLayout, groupFieldsByLayout, LAYOUT_KEY } from './use-schema-form.js';
export type { LayoutGroup, LayoutOptions } from './use-schema-form.js';

export { useVariablePicker } from './use-variable-picker.js';
export type { UseVariablePickerOptions, UseVariablePickerReturn, VariableNode } from './use-variable-picker.js';

export { useConditionEditor } from './use-condition-editor.js';
export type { UseConditionEditorOptions, UseConditionEditorReturn } from './use-condition-editor.js';

export { useStepConfig } from './use-step-config.js';
export type { UseStepConfigOptions, UseStepConfigReturn } from './use-step-config.js';

export { useTriggerConfig } from './use-trigger-config.js';
export type { UseTriggerConfigOptions, UseTriggerConfigReturn } from './use-trigger-config.js';

export { useStepMetadata } from './use-step-metadata.js';
export type { StepMeta, TriggerMeta, UseStepMetadataReturn } from './use-step-metadata.js';

// ─── Data fetching ───
export { useWorkflowList } from './use-workflow-list.js';
export type { UseWorkflowListReturn } from './use-workflow-list.js';
export { useFolderList } from './use-folder-list.js';
export type { UseFolderListReturn } from './use-folder-list.js';
export { useWorkflowCounts } from './use-workflow-counts.js';
export type { UseWorkflowCountsReturn } from './use-workflow-counts.js';

export { useRunsList } from './use-runs-list.js';
export type { UseRunsListOptions, UseRunsListReturn } from './use-runs-list.js';

export { useApprovalsList } from './use-approvals-list.js';
export type { ApprovalFilters, UseApprovalsListReturn } from './use-approvals-list.js';
export { useApprovalCount } from './use-approval-count.js';

export { usePendingWorkflows } from './use-pending-workflows.js';
export type { UsePendingWorkflowsReturn } from './use-pending-workflows.js';

export { useCredentialList } from './use-credential-list.js';
export type { UseCredentialListReturn } from './use-credential-list.js';

export { useLastRuns } from './use-last-runs.js';
export type { LastRunEntry } from './use-last-runs.js';

export { useDebouncedValue } from './use-debounced-value.js';

// ─── Execution ───
export { useExecutionViewer } from './use-execution-viewer.js';
export type {
  UseExecutionViewerOptions,
  UseExecutionViewerReturn,
  StepExecutionState,
  StepExecutionStatus,
  ExecutionViewerStatus,
} from './use-execution-viewer.js';

export { usePauseInteraction } from './use-pause-interaction.js';
export type { UsePauseInteractionOptions, UsePauseInteractionReturn } from './use-pause-interaction.js';

export { useExecutionRerun } from './use-execution-rerun.js';
export type { UseExecutionRerunOptions, UseExecutionRerunReturn } from './use-execution-rerun.js';
