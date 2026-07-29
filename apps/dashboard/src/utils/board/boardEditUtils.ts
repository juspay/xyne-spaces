import type { BoardMetadata, TicketFormConfig, FieldEnumOption } from '@xyne/shared';
import type { TicketField } from '../../components/Board/BoardEditScreen/BoardEditScreen.types';
/**
 * Extract ticket form config from board metadata
 */
export const getTicketFormConfig = (boardData: unknown): TicketFormConfig | null => {
  if (!boardData || typeof boardData !== 'object') return null;
  const metadata = (boardData as { metadata?: BoardMetadata }).metadata;
  return metadata?.ticketFormConfig || null;
};

/**
 * Extract field order from board metadata
 */
export const getFieldOrderFromMetadata = (
  boardData: unknown,
): Array<{ fieldId: string; fieldType: 'core' | 'custom' }> | null => {
  if (!boardData || typeof boardData !== 'object') return null;
  const metadata = (boardData as { metadata?: BoardMetadata }).metadata;
  return metadata?.fieldOrder || null;
};

/**
 * Filter fields for ticket preview/create based on visibility and form config
 */
export const filterFieldsForPreview = (
  fields: TicketField[],
  ticketFormConfig: TicketFormConfig | null,
): TicketField[] => {
  return fields
    .filter(f => {
      if (!f.visibleInCreate) return false;
      if (f.name === 'dueDate' && ticketFormConfig) {
        return ticketFormConfig.dueDate?.enabled ?? true;
      }
      return true;
    })
    .sort((a, b) => a.order - b.order);
};

/**
 * Map TicketField to preview field format
 */
export const mapToPreviewFields = (
  fields: TicketField[],
): Array<{
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: FieldEnumOption[];
}> => {
  return fields.map(field => ({
    id: field.id,
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.options && { options: field.options }),
  }));
};

/**
 * Map TicketField to create modal field format
 */
export const mapToCreateModalFields = (
  fields: TicketField[],
): Array<{
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  visibleInCreate: boolean;
  options?: FieldEnumOption[];
}> => {
  return fields.map(field => ({
    id: field.id,
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    order: field.order,
    visibleInCreate: field.visibleInCreate,
    ...(field.options && { options: field.options }),
  }));
};

/**
 * Get config key for field name mapping
 */
export const getFieldConfigKey = (fieldName: string): string => {
  switch (fieldName) {
    case 'assignedTo':
      return 'assignedTo';
    case 'status':
      return 'todo';
    case 'workflowType':
      return 'workflows';
    case 'tags':
      return 'labels';
    case 'ticketType':
      return 'ticketType';
    default:
      return fieldName;
  }
};
