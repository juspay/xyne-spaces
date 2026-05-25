import type { Condition, OperatorMeta } from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

export interface ConditionEditorProps {
  value: Condition;
  onChange: (next: Condition) => void;
  operators: OperatorMeta[];
  variableSources: VariablePickerSource[];
  depth?: number;
}
