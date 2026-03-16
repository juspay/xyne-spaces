import type { TicketField } from '../BoardEditScreen/BoardEditScreen.types';

export type FieldType = 'text' | 'select' | 'multiselect' | 'boolean' | 'date' | 'user';

export interface CustomFieldProps {
  mode: 'create' | 'edit';
  field?: TicketField;
  onSave: (field: Omit<TicketField, 'id' | 'order'> & { id?: string }) => void;
  onCancel: () => void;
  existingFieldCount?: number;
}
