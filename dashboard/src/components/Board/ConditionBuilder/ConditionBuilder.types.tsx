import { type User } from '@xyne/shared';
import type { StageCondition } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { type SelectOption } from '../../../utils/board';

export interface SelectDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  variant?: 'when' | 'then';
}

export interface ConditionBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (condition: StageCondition) => void;
  onDelete?: ((conditionId: string) => void) | undefined;
  condition?: StageCondition | null;
  onOpenCreateForm?: (condition?: StageCondition) => void;
  nextStageName?: string | undefined;
  allStages?: Array<{ name: string; sequenceNumber: number; formId?: string }>;
}

export interface FormDropdownProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onCreateFormClick?: (() => void) | undefined;
  showStageNameInsteadOfForm?: boolean;
  allStages?: Array<{ name: string; sequenceNumber: number; formId?: string }>;
  allForms?: Array<{ id: string; formName: string }>;
}

export interface ApproverDropdownProps {
  selectedApprovers: User[];
  onApproversChange: (approvers: User[]) => void;
  disabled?: boolean;
}
