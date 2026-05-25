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
