import type { JsonSchema, ValidationIssue } from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

export interface SchemaFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues?: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources?: VariablePickerSource[];
}
