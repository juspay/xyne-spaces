import type { TicketField } from '../BoardEditScreen/BoardEditScreen.types';

export type FieldType = 'text' | 'select' | 'multiselect' | 'boolean' | 'date' | 'user';

export interface CustomFieldProps {
  mode: 'create' | 'edit';
  field?: TicketField;
  projectId?: string | undefined;
  onSave: (field: Omit<TicketField, 'id' | 'order'> & { id?: string }) => void;
  onCancel: () => void;
  existingFieldCount?: number;
  // Names of branch fields belonging to an option, used to confirm ambiguous bulk renames.
  getDependentFieldNames?: (optionId: string) => string[];
  // Reports an unresolved rename/replace decision so the parent can block the board save too.
  onPendingDecisionChange?: (hasPending: boolean) => void;
  // Branch management, shown per-option when editing a top-level Single Select field.
  getBranchFields?: (optionId: string) => TicketField[];
  onSaveBranchField?: (
    optionId: string,
    field: Omit<TicketField, 'id' | 'order'> & { id?: string },
    existingFieldId?: string,
  ) => void;
  onDeleteBranchField?: (fieldId: string) => void;
}
