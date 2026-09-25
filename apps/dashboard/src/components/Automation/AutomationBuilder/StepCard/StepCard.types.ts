import type {
  ActionStepConfig,
  StepCatalogItem,
  StepSchema,
  ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

export interface StepCardProps {
  step: ActionStepConfig;
  catalogItem: StepCatalogItem | null;
  schema: StepSchema | null;
  schemaLoading?: boolean;
  index: number;
  /** Label shown instead of `index`, e.g. the flow view's nested "1.2". */
  displayIndex?: string;
  total: number;
  variableSources: VariablePickerSource[];
  onConfigChange: (config: Record<string, unknown>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  issues?: ValidationIssue[];
  pathPrefix: string;
  readOnly?: boolean;
}
