import { FormFieldType } from '@xyne/shared';

// ─── Condition Builder Field Types ───────────────────────────────────────────
export type WhenFieldType = 'status' | 'pr_status' | 'form';
export type ThenFieldType = 'form' | 'status' | 'approver';

export interface WhenFieldOption {
  value: WhenFieldType | '';
  label: string;
}

export interface ThenFieldOption {
  value: ThenFieldType | '';
  label: string;
  whenField: WhenFieldType;
}

export interface ConditionOption {
  value: string;
  label: string;
  whenField: WhenFieldType;
}

export interface ThenConditionOption {
  value: string;
  label: string;
  thenField: ThenFieldType;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldTypeOption {
  value: FormFieldType;
  label: string;
}
