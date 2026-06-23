import type { TicketField } from './BoardEditScreen.types';
import { FIELD_TYPE_OPTIONS } from '../../../utils/board';

// Field type options for display (includes mappings for core fields)
const fieldTypeOptionsDisplay = [
  ...FIELD_TYPE_OPTIONS,
  { value: 'board', label: 'String' },
  { value: 'project', label: 'String' },
  { value: 'status', label: 'String' },
  { value: 'priority', label: 'String' },
  { value: 'workflow', label: 'String' },
];

/**
 * Get the display label for a field type
 * @param fieldType - The field type to get the label for
 * @returns The display label for the field type
 */
export const getFieldTypeLabel = (fieldType: TicketField['type']): string => {
  const option = fieldTypeOptionsDisplay.find(opt => opt.value === fieldType);
  if (option) return option.label;

  // Fallback: convert field type to readable label
  switch (fieldType) {
    case 'text':
      return 'String';
    case 'select':
      return 'Single Select';
    case 'multiselect':
      return 'Multi Select';
    case 'date':
      return 'Date';
    case 'user':
      return 'User';
    case 'boolean':
      return 'Boolean';
    case 'doc':
      return 'Document';
    default:
      return 'String';
  }
};
