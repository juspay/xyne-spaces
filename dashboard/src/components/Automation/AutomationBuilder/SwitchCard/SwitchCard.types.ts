import type {
  ConditionalStepConfig,
  SwitchStepConfig,
  OperatorMeta,
  StepCatalogItem,
  ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ControlFlowRenderProps } from '../BranchSteps/BranchSteps';

export interface SwitchCardProps {
  step: SwitchStepConfig;
  catalog: StepCatalogItem[];
  schemaCache: Record<string, import('../../Automation.types').StepSchema | undefined>;
  schemaLoadingFor: (type: string) => boolean;
  operators: OperatorMeta[];
  variableSources: VariablePickerSource[];
  index: number;
  total: number;
  onChange: (next: SwitchStepConfig) => void;
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
