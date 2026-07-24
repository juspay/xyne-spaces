import type {
  AutomationStepConfig,
  ConditionalStepConfig,
  OperatorMeta,
  StepCatalogItem,
  SwitchStepConfig,
  ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ControlFlowRenderProps } from '../BranchSteps/BranchSteps';

export interface ConditionalCardProps {
  step: ConditionalStepConfig;
  catalog: StepCatalogItem[];
  schemaCache: Record<string, import('../../Automation.types').StepSchema | undefined>;
  schemaLoadingFor: (type: string) => boolean;
  operators: OperatorMeta[];
  variableSources: VariablePickerSource[];
  index: number;
  total: number;
  onChange: (next: ConditionalStepConfig) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  issues: ValidationIssue[];
  pathPrefix: string;
  readOnly?: boolean;
  ensureSchema: (type: string) => void;
  renderConditionalCard: (
    step: ConditionalStepConfig,
    props: ControlFlowRenderProps,
  ) => React.ReactElement;
  renderSwitchCard: (step: SwitchStepConfig, props: ControlFlowRenderProps) => React.ReactElement;
}

export interface BranchEditorAPI {
  updateAt: (index: number, next: AutomationStepConfig) => void;
  append: (step: AutomationStepConfig) => void;
  removeAt: (index: number) => void;
  move: (index: number, direction: -1 | 1) => void;
}
