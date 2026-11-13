// Types barrel — re-exports every public type from the SDK.

export {
  // Step type enums
  BuiltinStepType,
  BuiltinStepTypeSchema,
  CONVERSATIONAL_FLOW_KIND,
  GateCategory,
  ControlFlowStepTypeSchema,
  CONTROL_FLOW_STEP_TYPES,
  // Trigger type enums
  BuiltinTriggerType,
  BuiltinTriggerTypeSchema,
} from './known-types.js';
export type { ControlFlowStepType } from './known-types.js';

export type { StepType } from './step-types.js';

export type { TriggerType } from './trigger-types.js';

export {
  TriggerCategory,
  TriggerCategorySchema,
} from './categories.js';
export type { StepCategory } from './categories.js';

export {
  ConditionOperator,
  ConditionOperatorSchema,
  VALUE_LESS_OPERATORS,
  OPERATOR_DESCRIPTORS,
} from './operators.js';
export type { OperatorDescriptor } from './operators.js';

export {
  WorkflowStatus,
  WorkflowStatusSchema,
  isLiveStatus,
  isProposalStatus,
  isTerminalProposalStatus,
  ExecutionStatus,
  ExecutionStatusSchema,
} from './status.js';

export { ApprovalRequirement } from './approval.js';
export type { ApprovalConfig, ApprovalGate } from './approval.js';

export {
  ValidationIssueCode,
  ValidationIssueCodeSchema,
} from './validation.js';
export type { ValidationIssue, ValidationIssueLocation, ValidationResult } from './validation.js';

export type {
  TriggerContext,
  StepContextEntry,
  WorkflowContext,
} from './context.js';

export type { PausePathSegment, PausePath } from './pause-path.js';

export type {
  PauseDisplaySection,
  PauseFormFieldOption,
  PauseFormField,
  PauseForm,
  PauseAction,
  PauseState,
} from './pause-state.js';

// A value, so it has to live on a subpath a browser can import: the root entry
// reaches the connectors, and with them Node builtins like `node:dns`.
export { promptLines } from './pause-state.js';

// `Attachment`, `ResumePayload`, `ResumeAttachment`, `ResumeAction` now live
// in `src/common/` — import them from `@xyne/workflow-sdk/common` (browser-safe)
// or from the main `@xyne/workflow-sdk` barrel.

export type {
  StepProgressEventType,
  StepProgressEvent,
  StepEventRecord,
} from './step-events.js';

export {
  variableRef,
  getVariableRefInnerSchema,
  LeafConditionSchema,
  ConditionSchema,
  WorkflowSettingsSchema,
  readDottedPath,
} from './workflow-config.js';
export type {
  LeafCondition,
  Condition,
  ActionStepConfig,
  ConditionalStepConfig,
  SwitchCaseEntry,
  SwitchStepConfig,
  WorkflowStepConfig,
  StepConfigBase,
  StepGroup,
  Citation,
  WorkflowSettings,
  WorkflowRunNaming,
  WorkflowConfig,
  StepCompletionGate,
} from './workflow-config.js';

export {
  WorkflowVariableSchema,
  VariableKeySchema,
  projectVariables,
  varsJsonSchema,
} from './workflow-variable.js';
export type {
  WorkflowVariable,
  WorkflowVariableType,
  VariableValue,
  JsonValue,
} from './workflow-variable.js';
