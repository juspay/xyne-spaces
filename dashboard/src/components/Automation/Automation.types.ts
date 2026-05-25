export type {
  Automation,
  AutomationConfig,
  AutomationStepConfig,
  ActionStepConfig,
  ConditionalStepConfig,
  AutomationRun,
  Condition,
  LeafCondition,
  JsonSchema,
  OperatorMeta,
  ScheduleConfig,
  ScheduleOffset,
  ScheduleOffsetUnit,
  StepCatalogItem,
  StepSchema,
  TriggerCatalogItem,
  TriggerSchema,
  ValidationIssue,
  ValidationIssueCode,
  ValidationResult,
  SaveResult,
  ActivateResult,
  AutomationStatus,
  AutomationRunStatus,
  StepKind,
} from '../../api/automationsApi';

export {
  AutomationStatusValues,
  AutomationRunStatusValues,
  MAX_SCHEDULE_OFFSET_MINUTES,
  ScheduleOffsetUnitValues,
  StepKindValues,
  isLiveStatus,
  isProposalStatus,
  isTerminalProposalStatus,
} from '../../api/automationsApi';

export const CONDITIONAL_STEP_TYPE = 'CONDITIONAL';

export {
  VARIABLE_REF_REGEX,
  VARIABLE_REF_DESCRIPTION_PREFIX,
} from '@xyne/shared/automations/variable-ref';

export function makeStepId(): string {
  return `stp_${cryptoRandom()}`;
}

function cryptoRandom(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
