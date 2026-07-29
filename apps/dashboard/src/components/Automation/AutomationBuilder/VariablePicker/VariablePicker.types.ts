import type { JsonSchema } from '../../Automation.types';

export type VariablePickerSourceRole = 'trigger' | 'input' | 'output';

export interface VariablePickerSource {
  sourceKey: string;
  role: VariablePickerSourceRole;
  label: string;
  sublabel?: string;
  groupKey: string;
  groupLabel: string;
  schema: JsonSchema;
}

export interface VariableEntry {
  sourceKey: string;
  role: VariablePickerSourceRole;
  path: string;
  label: string;
  leafType: string;
  reference: string;
  entityKind?: string | null;
}

export interface VariablePickerProps {
  sources: VariablePickerSource[];
  onSelect: (entry: VariableEntry) => void;
  onClose: () => void;
  targetEntityKind?: string | null;
  targetLeafType?: string | null;
}
